package server

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestOpenAIStreamDoneDoesNotWaitForTransportEOF(t *testing.T) {
	stream := "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1723,\"completion_tokens\":464,\"total_tokens\":2187}}\n\ndata: [DONE]\n\n"
	reader := &failingReader{data: []byte(stream), err: context.Canceled}
	var output strings.Builder
	usage, err := copyOpenAIStreamAndUsage(&output, reader)
	if err != nil {
		t.Fatalf("completed protocol stream failed on transport tail: %v", err)
	}
	if output.String() != stream || usage.PromptTokens != 1723 || usage.CompletionTokens != 464 || usage.TotalTokens != 2187 {
		t.Fatalf("output=%q usage=%+v", output.String(), usage)
	}
}

func TestOpenAIStreamCancellationBeforeDoneStillFails(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"
	var output strings.Builder
	_, err := copyOpenAIStreamAndUsage(&output, &failingReader{data: []byte(stream), err: context.Canceled})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation before terminal marker = %v", err)
	}
}

func TestOpenAIStreamDoneWriteFailureStillFails(t *testing.T) {
	_, err := copyOpenAIStreamAndUsage(doneFailWriter{}, strings.NewReader("data: [DONE]\n\n"))
	if !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("terminal write failure = %v", err)
	}
}

type doneFailWriter struct{}

func (doneFailWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
