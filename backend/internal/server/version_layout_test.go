package server

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func renameNativeTestLayout(t *testing.T, root string) {
	t.Helper()
	for _, old := range []string{"bin/tokenhub", "bin/tokenhub-run", "deploy/tokenhub.service"} {
		if err := os.Rename(filepath.Join(root, old), filepath.Join(root, strings.ReplaceAll(old, "tokenhub", "tokenstation"))); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNativeLayoutsActivationRollbackAndPendingRestart(t *testing.T) {
	root := prepareNativeInstallRoot(t, "0.3.2", map[string]string{"0.3.1": "old", "0.3.3": "new"})
	renameNativeTestLayout(t, filepath.Join(root, "releases", "0.3.3"))
	upstream := httptest.NewServer(http.NotFoundHandler())
	defer upstream.Close()
	service := nativeTestVersionService(root, "0.3.2", upstream)
	for _, version := range []string{"0.3.3", "0.3.1"} {
		if err := service.activateNativeRelease(version); err != nil {
			t.Fatal(err)
		}
		if got := service.pendingNativeRestartVersion(); got != version {
			t.Fatalf("pending = %s, want %s", got, version)
		}
		for _, runner := range []string{"tokenhub-run", "tokenstation-run"} {
			if _, err := os.Stat(filepath.Join(root, "current", "bin", runner)); err != nil {
				t.Fatal(err)
			}
		}
	}
	mixed := filepath.Join(root, "releases", "0.3.3")
	if err := os.Rename(filepath.Join(mixed, "deploy/tokenstation.service"), filepath.Join(mixed, "deploy/tokenhub.service")); err != nil {
		t.Fatal(err)
	}
	if err := validateNativeBundle(mixed, "0.3.3"); err == nil {
		t.Fatal("accepted incomplete mixed layout")
	}
}

func TestNativeUpdatePrefersNewArchiveAndUsesSelectedChecksum(t *testing.T) {
	for _, bad := range []bool{false, true} {
		t.Run(map[bool]string{false: "valid", true: "wrong checksum"}[bad], func(t *testing.T) {
			root := prepareNativeInstallRoot(t, "0.3.1", nil)
			archive := nativeTestArchive(t, "0.3.2", map[string]nativeTestArchiveEntry{
				"bin/tokenhub":                {mode: -1},
				"bin/tokenhub-run":            {mode: -1},
				"deploy/tokenhub.service":     {mode: -1},
				"bin/tokenstation":            {content: "#!/bin/sh\nexit 0\n", mode: 0755},
				"bin/tokenstation-run":        {content: "runner", mode: 0755},
				"deploy/tokenstation.service": {content: "unit", mode: 0644},
			})
			sum := sha256.Sum256(archive)
			name := "tokenstation_0.3.2_linux_amd64.tar.gz"
			digest := hex.EncodeToString(sum[:])
			if bad {
				digest = strings.Repeat("0", 64)
			}
			var upstream *httptest.Server
			upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/repos/test/TokenHub/releases/latest":
					release := nativeTestRelease("v0.3.2", name, upstream.URL)
					release["assets"] = append(release["assets"].([]map[string]any), map[string]any{"name": "tokenhub_0.3.2_linux_amd64.tar.gz", "browser_download_url": upstream.URL + "/legacy", "size": 1024})
					writeTestJSON(w, release)
				case "/assets/" + name:
					_, _ = w.Write(archive)
				case "/assets/checksums.txt":
					_, _ = w.Write([]byte(digest + "  " + name + "\n" + hex.EncodeToString(sum[:]) + "  tokenhub_0.3.2_linux_amd64.tar.gz\n"))
				default:
					t.Errorf("unexpected legacy request %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer upstream.Close()
			service := nativeTestVersionService(root, "0.3.1", upstream)
			service.databaseURL = "sqlite://test.db"
			_, err := service.performNativeUpdate(t.Context())
			if bad {
				if err == nil || !strings.Contains(err.Error(), "SHA-256") {
					t.Fatalf("error = %v", err)
				}
				assertNativeCurrentVersion(t, root, "0.3.1")
			} else {
				if err != nil {
					t.Fatal(err)
				}
				assertNativeCurrentVersion(t, root, "0.3.2")
			}
		})
	}
}
