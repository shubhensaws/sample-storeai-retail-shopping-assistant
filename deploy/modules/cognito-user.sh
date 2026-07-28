#!/usr/bin/env bash
# cognito-user (ops) — create/confirm the admin Cognito sign-in user WITHOUT ever
# storing a password in config:
#   • a real admin email  -> Cognito emails a one-time invitation; the user sets their
#                            own password on first sign-in (needs no SES — Cognito's
#                            built-in email delivers the invite).
#   • no email (default)  -> create admin@storeai.local with NO password; the operator
#                            sets one via the printed CLI command (or the Cognito console).
set -euo pipefail

_r() { python3 "${LIB_DIR}/resolve.py" --config "$1" get "$2" 2>/dev/null; }

mod_deploy() {
  local config="$1" region env tfdir pool email
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  env=$(_r "$config" global.env); env="${env:-dev}"
  tfdir="${PROJECT_DIR}/infra/terraform"

  pool=$(terraform -chdir="$tfdir" output -raw cognito_user_pool_id 2>/dev/null || true)
  if [ -z "${pool:-}" ] || [ "$pool" = "None" ]; then
    echo "  ERROR: cognito user pool not found (deploy data-plane first)." >&2
    return 1
  fi

  email=$(_r "$config" prerequisites.auth.adminEmail)

  if [ -n "$email" ] && [ "$email" != "None" ] && [ "$email" != "admin@storeai.local" ]; then
    # (a) Real email: Cognito emails a one-time invitation; the user sets their own
    #     password on first sign-in. No password is ever set by us or stored in config.
    echo "  creating admin Cognito user '${email}' with an email invitation (pool ${pool})"
    if aws cognito-idp admin-create-user \
          --user-pool-id "$pool" \
          --username "$email" \
          --user-attributes Name=email,Value="$email" Name=email_verified,Value=true \
          --desired-delivery-mediums EMAIL \
          --region "$region" >/dev/null 2>&1; then
      echo "  ✓ Invitation email sent to ${email}."
      echo "    Sign in with the temporary password from that email — you'll be prompted to set your own."
    else
      echo "  user ${email} already exists — password left untouched."
      echo "    Resend an invite with:"
      echo "      aws cognito-idp admin-create-user --user-pool-id ${pool} --username '${email}' \\"
      echo "        --message-action RESEND --desired-delivery-mediums EMAIL --region ${region}"
    fi
  else
    # (b) No email: create a placeholder user with NO password. The operator sets one
    #     out-of-band (CLI or Cognito console) — nothing sensitive lands in config.
    email="admin@storeai.local"
    echo "  creating placeholder admin user '${email}' (no email configured) in pool ${pool}"
    aws cognito-idp admin-create-user \
      --user-pool-id "$pool" \
      --username "$email" \
      --message-action SUPPRESS \
      --user-attributes Name=email,Value="$email" Name=email_verified,Value=true \
      --region "$region" >/dev/null 2>&1 || echo "  (user already exists — leaving it as-is)"
    echo "  ⚠ No password is set. Set one before signing in — via the Cognito console, or run:"
    echo ""
    echo "      aws cognito-idp admin-set-user-password \\"
    echo "        --user-pool-id ${pool} --username ${email} \\"
    echo "        --password 'REPLACE-WITH-A-STRONG-PASSWORD' --permanent --region ${region}"
    echo ""
    echo "    (policy: >=8 chars incl. upper, lower and a number). Then sign in as ${email}."
  fi
}

mod_teardown() {
  local config="$1" region env tfdir pool email
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  tfdir="${PROJECT_DIR}/infra/terraform"
  pool=$(terraform -chdir="$tfdir" output -raw cognito_user_pool_id 2>/dev/null || true)
  email=$(_r "$config" prerequisites.auth.adminEmail); email="${email:-admin@storeai.local}"
  [ -n "${pool:-}" ] && aws cognito-idp admin-delete-user --user-pool-id "$pool" --username "$email" --region "$region" >/dev/null 2>&1 || true
}

mod_verify() {
  local config="$1" region tfdir pool
  region=$(_r "$config" global.region); region="${region:-us-east-2}"
  tfdir="${PROJECT_DIR}/infra/terraform"
  pool=$(terraform -chdir="$tfdir" output -raw cognito_user_pool_id 2>/dev/null || true)
  [ -n "${pool:-}" ] && aws cognito-idp list-users --user-pool-id "$pool" --region "$region" --query 'Users[].Username' --output text 2>/dev/null || true
}
