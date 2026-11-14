import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const helpers = read("deploy/helm/tokenstation/templates/_helpers.tpl");

test("Helm defaults preserve legacy release selectors without overriding explicit names", () => {
  const name = helpers.match(/define "tokenstation.name"[\s\S]*?(?=\{\{\/\*)/)[0];
  assert.match(name, /\$defaultName := \.Chart.Name/);
  assert.match(name, /if eq \.Release.Name "tokenhub"[\s\S]*?\$defaultName = "tokenhub"/);
  assert.match(name, /default \$defaultName \.Values.nameOverride \| trunc 63 \| trimSuffix "-"/);
  assert.doesNotMatch(name, /IsUpgrade/);
  assert.match(helpers, /if \.Values.fullnameOverride[\s\S]*?\.Values.fullnameOverride \| trunc 63/);
  assert.match(helpers, /printf "%s-%s" \.Release.Name \(include "tokenstation.name" \.\)/);
  assert.match(helpers, /app.kubernetes.io\/name: \{\{ include "tokenstation.name" \. }}/);
  assert.match(read("deploy/helm/tokenstation/Chart.yaml"), /^name: tokenstation$/m);
});

test("Helm image PVC retains the same fullname source as deployment selectors", () => {
  assert.match(read("deploy/helm/tokenstation/templates/image-storage.yaml"), /name: \{\{ include "tokenstation.fullname" \. }}-images/);
  assert.match(read("deploy/helm/tokenstation/templates/deployment.yaml"), /include "tokenstation.selectorLabels"/);
  assert.match(read("deploy/helm/tokenstation/templates/_pod.tpl"), /include "tokenstation.fullname" \. }}-images/);
});

test("all deployment translations explain release and PVC upgrade compatibility", () => {
  for (const path of ["docs/deployment.md", "docs/zh-CN/deployment.md", "docs/ja/deployment.md"]) {
    const source = read(path);
    assert.ok(source.includes("helm upgrade <existing-release> deploy/helm/tokenstation -n <existing-namespace> -f <existing-values.yaml> --set nameOverride=tokenhub"), path);
    assert.ok(source.includes("helm upgrade --install tokenstation"), path);
    assert.ok(source.includes("`nameOverride`/`fullnameOverride`"), path);
  }
});
