#!/bin/sh
set -eu
count=0
start_at=${1:-001}
for migration in /tmp/migrations/[0-9]*.sql; do
  number=${migration##*/}
  number=${number%%_*}
  if [ "$number" -lt "$start_at" ]; then continue; fi
  expected_hash=''
  case "$number" in
    084) expected_hash=4c7a392e7948eb7efc3a9b7cfb4208c6093668d2989f80c1e498334ddf9938e5 ;;
    085) expected_hash=b544c985ec6de26e17efd082174070f9a3dbb004ed2d0e85d08040793e5884e7 ;;
    086) expected_hash=7bcf1ca3aefff0e495e41979c3fc70e50bf4f0967546d9403a7278d64ed0ba3b ;;
    087) expected_hash=011fe95a1851c0458c12a6f7ba6b08311bab1bd7feb593246c5a7c996ffd9cc0 ;;
    093) expected_hash=e2c91d28f9fba7e639f2cd2cc7598a4841c920cad3f7992e7b11f74b83cb0d4a ;;
  esac
  if [ -n "$expected_hash" ]; then
    actual_hash=$(sha256sum "$migration")
    actual_hash=${actual_hash%% *}
    if [ "$actual_hash" != "$expected_hash" ]; then
      echo "FAILED: adapted historical migration changed: $migration"
      exit 1
    fi
  fi
  if [ "$number" = 082 ]; then
    if ! psql -v ON_ERROR_STOP=1 -d postgres -f /tmp/sql/local-pre-082.sql > /tmp/migration-last.log 2>&1; then
      echo 'FAILED fictional fixture before 082'
      tail -n 24 /tmp/migration-last.log
      exit 1
    fi
  fi
  if [ "$number" = 108 ]; then
    if ! psql -v ON_ERROR_STOP=1 -d postgres -f /tmp/sql/local-pre-108.sql > /tmp/migration-last.log 2>&1; then
      echo 'FAILED fictional timestamp fixture before 108'
      tail -n 24 /tmp/migration-last.log
      exit 1
    fi
  fi
  if [ "$number" = 095 ]; then
    if ! psql -v ON_ERROR_STOP=1 -d postgres -f /tmp/sql/local-pre-095.sql > /tmp/migration-last.log 2>&1; then
      echo 'FAILED fictional fixture before 095'
      tail -n 24 /tmp/migration-last.log
      exit 1
    fi
  fi
  if [ "$number" = 085 ]; then
    echo 'SKIPPED 085: historical reconciliation of 19+59 production peripheral links only'
    continue
  fi
  if [ "$number" = 084 ]; then
    # The 084 data repair is intentionally tied to three production UUIDs.
    # Reproduce its lasting schema/functions, not the production-data repair.
    sed -n '/^-- Novos chamados/,$p' "$migration" | \
      psql -v ON_ERROR_STOP=1 -d postgres \
        -c "set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001'" \
        -f - > /tmp/migration-last.log 2>&1 || {
          echo 'FAILED structural portion of 084'
          tail -n 24 /tmp/migration-last.log
          exit 1
        }
    echo 'SKIPPED production-specific data repair in 084; structural portion applied'
  elif [ "$number" = 086 ]; then
    # Keep the persistent functions/triggers; omit the 78-row location repair.
    { printf 'begin;\n'; sed -n '91,238p;271,342p' "$migration"; printf 'commit;\n'; } | \
      psql -v ON_ERROR_STOP=1 -d postgres \
        -c "set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001'" \
        -f - > /tmp/migration-last.log 2>&1 || {
          echo 'FAILED structural portion of 086'
          tail -n 24 /tmp/migration-last.log
          exit 1
        }
    echo 'SKIPPED production-specific 78-row location repair in 086; structural portion applied'
  elif [ "$number" = 087 ]; then
    # The opening/closing checks require exactly 33 legacy positions/20 PCs.
    { printf 'begin;\n'; sed -n '50,156p' "$migration"; printf 'commit;\n'; } | \
      psql -v ON_ERROR_STOP=1 -d postgres \
        -c "set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001'" \
        -f - > /tmp/migration-last.log 2>&1 || {
          echo 'FAILED structural portion of 087'
          tail -n 24 /tmp/migration-last.log
          exit 1
        }
    echo 'SKIPPED production-specific 33-position/20-computer assertions in 087; schema applied'
  elif [ "$number" = 093 ]; then
    # Final block reconciles two named AJMON devices from the real inventory.
    { sed -n '1,358p' "$migration"; printf 'commit;\n'; } | \
      psql -v ON_ERROR_STOP=1 -d postgres \
        -c "set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001'" \
        -f - > /tmp/migration-last.log 2>&1 || {
          echo 'FAILED structural portion of 093'
          tail -n 24 /tmp/migration-last.log
          exit 1
        }
    echo 'SKIPPED production-specific AJMON reconciliation in 093; schema applied'
  elif ! psql -v ON_ERROR_STOP=1 -d postgres \
    -c "set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001'" \
    -f "$migration" > /tmp/migration-last.log 2>&1; then
    printf 'FAILED %s\n' "$migration"
    tail -n 24 /tmp/migration-last.log
    exit 1
  fi
  if [ "$number" = 108 ]; then
    if ! psql -v ON_ERROR_STOP=1 -d postgres -f /tmp/sql/local-post-108.sql > /tmp/migration-last.log 2>&1; then
      echo 'FAILED fictional timestamp fixture after 108'
      tail -n 24 /tmp/migration-last.log
      exit 1
    fi
  fi
  count=$((count + 1))
  printf 'OK %s\n' "${migration##*/}"
done
printf 'Applied %s migrations in isolated PostgreSQL.\n' "$count"
