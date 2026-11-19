{{/*
Expand the chart name.
*/}}

{{- define "tokenstation.name" -}}
{{- $defaultName := .Chart.Name -}}
{{- if eq .Release.Name "tokenhub" -}}
{{- $defaultName = "tokenhub" -}}
{{- end -}}
{{- default $defaultName .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name, used for resource names.
*/}}

{{- define "tokenstation.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "tokenstation.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common labels.
*/}}

{{- define "tokenstation.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "tokenstation.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels.
*/}}

{{- define "tokenstation.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tokenstation.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}

{{- define "tokenstation.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- include "tokenstation.fullname" . }}
{{- else }}
default
{{- end }}
{{- end }}

{{/*
Chart-managed credentials secret name.
*/}}

{{- define "tokenstation.secretName" -}}
{{- printf "%s-credentials" (include "tokenstation.fullname" .) }}
{{- end }}

{{/*
Database URL. Precedence: database.existingSecret (referenced directly, no
value to compose), then database.url, then the built-in subchart service.
Returns empty when the URL lives in an existing secret or is managed by the
External Secrets Operator.
*/}}

{{- define "tokenstation.databaseURL" -}}
{{- if .Values.database.existingSecret }}
{{- else if .Values.database.url }}
{{- .Values.database.url }}
{{- else if .Values.postgresql.enabled }}
postgresql://{{ .Values.postgresql.auth.username }}:{{ .Values.postgresql.auth.password }}@{{ .Release.Name }}-postgresql:5432/{{ .Values.postgresql.auth.database }}?sslmode=disable
{{- end }}
{{- end }}

{{/*
Name of the secret the pod reads TOKENHUB_DATABASE_URL from. Precedence:
database.existingSecret, then the External Secrets Operator credentials
secret, then the chart-managed database secret.
*/}}

{{- define "tokenstation.databaseSecretName" -}}
{{- if .Values.database.existingSecret -}}
{{- .Values.database.existingSecret -}}
{{- else if .Values.externalSecret.enabled -}}
{{- include "tokenstation.secretName" . -}}
{{- else -}}
{{- printf "%s-database" (include "tokenstation.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Browser-facing API base URL for the admin console: the explicit value wins,
then the ingress scheme and host. Empty when neither applies (port-forward
usage keeps the frontend's localhost default).
*/}}

{{- define "tokenstation.apiBaseURL" -}}
{{- if .Values.apiBaseUrl -}}
{{- .Values.apiBaseUrl -}}
{{- else if and .Values.ingress.enabled .Values.ingress.host -}}
{{- if .Values.ingress.tls.enabled }}https://{{ .Values.ingress.host }}{{ else }}http://{{ .Values.ingress.host }}{{ end -}}
{{- end -}}
{{- end }}
