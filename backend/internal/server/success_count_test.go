package server

import (
	"fmt"
	"testing"
	"time"
)

func TestSuccessCountExcludesCallerCancellations(t *testing.T) {
	store := newTestMemoryStore(t)
	now := time.Now().UTC()
	logs := make([]RequestLog, 6)
	for i := range logs {
		status, code := 499, "request_cancelled"
		if i == 0 {
			status, code = 200, ""
		}
		logs[i] = RequestLog{ID: fmt.Sprintf("success-log-%d", i), RequestID: fmt.Sprintf("success-req-%d", i), ProjectID: "project-success", APIKeyID: "key-success", StatusCode: status, ErrorCode: code, CreatedAt: now}
	}
	if err := store.db.Create(&logs).Error; err != nil {
		t.Fatal(err)
	}
	scope := UsageSummaryScope{Global: true, CreatedAtFrom: now.Add(-time.Hour), CreatedAtBefore: now.Add(time.Hour)}
	query := UsageSummaryQuery{RequestLogs: scope, UsageRecords: scope}
	summary, err := store.QueryUsageSummary(t.Context(), query)
	if err != nil {
		t.Fatal(err)
	}
	if summary.RequestCount != 6 || summary.SuccessCount != 1 || summary.Errors != 0 {
		t.Fatalf("SQL summary = %+v", summary)
	}
	memory := summarizeUsage(nil, logs)
	if memory["success_count"] != 1 || memory["request_count"] != 6 || memory["errors"] != 0 {
		t.Fatalf("memory summary = %v", memory)
	}
	aggregate := &usageReportAggregate{location: time.UTC, granularity: "day", buckets: map[string]*UsageSummary{}}
	err = store.StreamUsageReportRecords(t.Context(), query, func(UsageRecord) {}, aggregate.addRequest)
	if err != nil {
		t.Fatal(err)
	}
	if aggregate.summary.SuccessCount != 1 || aggregate.summary.RequestCount != 6 || aggregate.summary.Errors != 0 {
		t.Fatalf("stream summary = %+v", aggregate.summary)
	}
	var merged UsageSummary
	for _, bucket := range aggregate.buckets {
		mergeUsageReportSummary(&merged, *bucket)
	}
	if merged.SuccessCount != 1 {
		t.Fatalf("merged summary = %+v", merged)
	}
	page, err := store.QueryRequestLogs(RequestLogQuery{Global: true, Page: 1, PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	if page.Summary.OK != summary.SuccessCount || page.Summary.All != summary.RequestCount {
		t.Fatalf("audit = %+v, summary = %+v", page.Summary, summary)
	}
	var row apiKeyUsageDatabaseRow
	if err := store.apiKeyUsageBaseQuery(store.db, APIKeyUsageQuery{Key: APIKey{ID: "key-success"}, From: now.Add(-time.Hour), To: now.Add(time.Hour)}).Select(apiKeyUsageMetricSelect()).Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if metrics := apiKeyUsageMetricsFromRow(row); metrics.SuccessCount != 1 || metrics.RequestCount != 6 || metrics.ErrorCount != 0 {
		t.Fatalf("key metrics = %+v", metrics)
	}
}
