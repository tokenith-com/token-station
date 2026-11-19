package server

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"math/big"
	"net/http"
	"strings"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gomonobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// Self-service registration is rate-limited with a server-drawn image CAPTCHA so
// that email activation links are only issued to human visitors. The challenge
// lives in memory, expires after a short window, and is consumed on success.

const (
	consumerCaptchaTTL         = 5 * time.Minute
	consumerCaptchaMaxAttempts = 5
	consumerCaptchaLength      = 4
	// consumerCaptchaAlphabet omits visually ambiguous characters (0/O/1/I).
	consumerCaptchaAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
)

type consumerCaptchaChallenge struct {
	code      string
	expiresAt time.Time
	attempts  int
}

var errConsumerCaptchaInvalid = NewHTTPError(400, "invalid_captcha", "The verification code is incorrect")
var errConsumerCaptchaExpired = NewHTTPError(400, "captcha_expired", "The verification code has expired, please refresh it")

func randomConsumerCaptchaCode(length int) (string, error) {
	out := make([]byte, length)
	max := big.NewInt(int64(len(consumerCaptchaAlphabet)))
	for i := range out {
		index, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = consumerCaptchaAlphabet[index.Int64()]
	}
	return string(out), nil
}

func captchaRandInt(n int) int {
	if n <= 1 {
		return 0
	}
	index, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0
	}
	return int(index.Int64())
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// drawCaptchaLine plots a Bresenham line so interference survives regardless of
// how the browser scales the returned PNG.
func drawCaptchaLine(img *image.RGBA, x0, y0, x1, y1 int, col color.RGBA) {
	dx := absInt(x1 - x0)
	dy := -absInt(y1 - y0)
	sx, sy := 1, 1
	if x0 > x1 {
		sx = -1
	}
	if y0 > y1 {
		sy = -1
	}
	err := dx + dy
	for {
		if x0 >= 0 && x0 < img.Bounds().Dx() && y0 >= 0 && y0 < img.Bounds().Dy() {
			img.Set(x0, y0, col)
		}
		if x0 == x1 && y0 == y1 {
			break
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x0 += sx
		}
		if e2 <= dx {
			err += dx
			y0 += sy
		}
	}
}

func renderConsumerCaptchaPNG(code string) ([]byte, error) {
	const width = 192
	const height = 84
	parsedFont, err := opentype.Parse(gomonobold.TTF)
	if err != nil {
		return nil, err
	}
	face, err := opentype.NewFace(parsedFont, &opentype.FaceOptions{Size: 76, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		return nil, err
	}
	defer face.Close()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 243, G: 241, B: 249, A: 255})
		}
	}
	// Interference lines in muted brand-adjacent tones.
	for i := 0; i < 4; i++ {
		drawCaptchaLine(img, captchaRandInt(width), captchaRandInt(height), captchaRandInt(width), captchaRandInt(height),
			color.RGBA{R: uint8(150 + captchaRandInt(80)), G: uint8(120 + captchaRandInt(90)), B: uint8(170 + captchaRandInt(70)), A: 255})
	}
	// Speckle noise.
	for i := 0; i < 90; i++ {
		img.Set(captchaRandInt(width), captchaRandInt(height),
			color.RGBA{R: uint8(captchaRandInt(256)), G: uint8(captchaRandInt(256)), B: uint8(captchaRandInt(256)), A: 255})
	}
	// Code glyphs with per-character colour and vertical jitter.
	bounds, advance := font.BoundString(face, code)
	startX := (fixed.I(width) - advance) / 2
	baseY := (fixed.I(height) - bounds.Max.Y - bounds.Min.Y) / 2
	for _, ch := range code {
		col := color.RGBA{R: uint8(50 + captchaRandInt(110)), G: uint8(40 + captchaRandInt(80)), B: uint8(90 + captchaRandInt(120)), A: 255}
		drawer := font.Drawer{Dst: img, Src: image.NewUniform(col), Face: face}
		drawer.Dot = fixed.Point26_6{X: startX, Y: baseY + fixed.I(captchaRandInt(7)-3)}
		drawer.DrawString(string(ch))
		startX += font.MeasureString(face, string(ch))
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (s *Server) handleConsumerRegisterCaptcha(w http.ResponseWriter, r *http.Request) {
	code, err := randomConsumerCaptchaCode(consumerCaptchaLength)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id := NewID("cap")
	now := time.Now().UTC()
	s.consumerCaptchaMu.Lock()
	if s.consumerCaptcha == nil {
		s.consumerCaptcha = make(map[string]consumerCaptchaChallenge)
	}
	s.consumerCaptcha[id] = consumerCaptchaChallenge{code: code, expiresAt: now.Add(consumerCaptchaTTL)}
	s.consumerCaptchaMu.Unlock()

	pngBytes, err := renderConsumerCaptchaPNG(code)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"captcha_id":      id,
		"image":           "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes),
		"expires_in_secs": int(consumerCaptchaTTL.Seconds()),
	})
}

// consumeConsumerCaptcha validates a one-time challenge. A wrong answer leaves
// the challenge available for a bounded number of retries; a correct answer, an
// unknown id, or an exhausted challenge removes it and fails.
func (s *Server) consumeConsumerCaptcha(id, answer string) error {
	id = strings.TrimSpace(id)
	answer = strings.ToUpper(strings.TrimSpace(answer))
	if id == "" || answer == "" {
		return errConsumerCaptchaInvalid
	}
	now := time.Now().UTC()
	s.consumerCaptchaMu.Lock()
	defer s.consumerCaptchaMu.Unlock()
	challenge, ok := s.consumerCaptcha[id]
	if !ok || now.After(challenge.expiresAt) {
		if ok {
			delete(s.consumerCaptcha, id)
		}
		return errConsumerCaptchaExpired
	}
	if challenge.code != answer {
		challenge.attempts++
		if challenge.attempts >= consumerCaptchaMaxAttempts {
			delete(s.consumerCaptcha, id)
			return errConsumerCaptchaExpired
		}
		s.consumerCaptcha[id] = challenge
		return errConsumerCaptchaInvalid
	}
	delete(s.consumerCaptcha, id)
	return nil
}
