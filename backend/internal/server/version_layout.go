package server

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type nativeLayout struct{ binary, runner, service string }

func resolveNativeLayout(root string) (nativeLayout, error) {
	for _, name := range []string{"tokenstation", "tokenhub"} {
		layout := nativeLayout{"bin/" + name, "bin/" + name + "-run", "deploy/" + name + ".service"}
		complete := true
		for _, path := range []string{layout.binary, layout.runner, layout.service} {
			info, err := os.Lstat(filepath.Join(root, path))
			if err != nil || !info.Mode().IsRegular() {
				complete = false
				break
			}
		}
		if complete {
			return layout, nil
		}
	}
	return nativeLayout{}, fmt.Errorf("native release has no complete tokenstation or tokenhub layout")
}

// Keep either installed systemd unit runnable across upgrades and rollbacks.
func ensureNativeRunnerCompatibility(root string) error {
	layout, err := resolveNativeLayout(root)
	if err != nil {
		return err
	}
	alias := "bin/tokenhub-run"
	if layout.runner == alias {
		alias = "bin/tokenstation-run"
	}
	path := filepath.Join(root, alias)
	if _, err := os.Lstat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	script := "#!/usr/bin/env bash\nexec \"$(dirname \"$0\")/" + filepath.Base(layout.runner) + "\" \"$@\"\n"
	return os.WriteFile(path, []byte(script), 0755)
}

func (s *versionService) nativeReleaseAssets(release githubRelease, version string) (githubAsset, githubAsset, error) {
	name, err := s.nativeArchiveName(version)
	if err != nil {
		return githubAsset{}, githubAsset{}, err
	}
	var checksum githubAsset
	for _, asset := range release.Assets {
		if asset.Name == "checksums.txt" {
			checksum = asset
		}
	}
	for _, candidate := range []string{name, strings.Replace(name, "tokenstation_", "tokenhub_", 1)} {
		for _, asset := range release.Assets {
			if asset.Name == candidate {
				return asset, checksum, nil
			}
		}
	}
	return githubAsset{}, checksum, nil
}
