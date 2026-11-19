package paymentmock

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
	"tokenhub/backend/internal/payment"
)

type fileConfig struct {
	Mode         string         `yaml:"mode"`
	PrepaidUsage bool           `yaml:"prepaid_usage"`
	Plans        []payment.Plan `yaml:"plans"`
	Mock         *mockConfig    `yaml:"mock"`
	Wechat       map[string]any `yaml:"wechat"`
	Alipay       map[string]any `yaml:"alipay"`
}

type mockConfig struct {
	Channel     string `yaml:"channel"`
	AutoSuccess bool   `yaml:"auto_success"`
}

func Load(path string) (*payment.Service, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	decoder := yaml.NewDecoder(io.LimitReader(file, 1<<20))
	decoder.KnownFields(true)
	var config fileConfig
	if err := decoder.Decode(&config); err != nil {
		return nil, errors.New("invalid mock payment YAML or unknown configuration field")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, errors.New("mock payment YAML must contain one document")
	}
	if config.Mode != "mock" || config.Mock == nil || config.Mock.Channel != payment.Wechat || !config.Mock.AutoSuccess {
		return nil, errors.New("mock payment requires mode: mock, wechat channel, and auto_success: true")
	}
	if config.Wechat != nil || config.Alipay != nil {
		return nil, errors.New("mock payment cannot include real payment channel configuration")
	}
	if len(config.Plans) == 0 || len(config.Plans) > 100 {
		return nil, errors.New("configure 1 to 100 payment plans")
	}
	seen := make(map[string]bool)
	for _, plan := range config.Plans {
		if plan.ID == "" || strings.TrimSpace(plan.ID) != plan.ID || strings.TrimSpace(plan.Name) == "" || plan.AmountFen < 1 || plan.AmountFen > 100000000 || seen[plan.ID] {
			return nil, fmt.Errorf("invalid or duplicate mock payment plan")
		}
		seen[plan.ID] = true
	}
	return &payment.Service{
		PrepaidUsage: config.PrepaidUsage,
		Plans:        config.Plans,
		Channels:     map[string]payment.Channel{payment.Wechat: NewChannel()},
	}, nil
}
