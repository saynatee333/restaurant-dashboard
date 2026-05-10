#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set"
  echo "Example: export DATABASE_URL='postgresql://user:pass@host:5432/postgres?sslmode=require'"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_sql() {
  local file="$1"
  echo "==> Applying ${file}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${ROOT_DIR}/${file}"
}

# Baseline schema and production-safe DDL
run_sql "sql/production_pos_schema.sql"

# Compatibility and operational layers
run_sql "supabase/phase1_pos_schema_compat.sql"
run_sql "supabase/phase1_1_workflow.sql"
run_sql "supabase/phase1_2_operations.sql"
run_sql "sql/performance_indexes.sql"
run_sql "sql/accounting_audit.sql"

# Current RPCs and multi-branch + role tables
run_sql "sql/pos_rpc_functions.sql"
run_sql "sql/multi_branch_roles.sql"
run_sql "sql/security_rls_audit.sql"
run_sql "sql/rls_guest_menu_select.sql"
run_sql "sql/rls_products_select_staff_include_global.sql"
run_sql "sql/seed_demo_product_images.sql"
run_sql "sql/auth_staff_profile_auto.sql"
run_sql "sql/grant_menu_products_read.sql"

echo "All migrations applied successfully."
