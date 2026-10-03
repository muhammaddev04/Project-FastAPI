# SeaweedFS S3 identities

Two configs, both mounted read-only at `/etc/seaweedfs/s3.json` inside the `storage` container:

| File | Used by | In Git |
| --- | --- | --- |
| `s3.json` | `docker-compose.yml`, `docker-compose.test.yml` | yes — dev-only credentials, not a secret |
| `s3.prod.json` | `docker-compose.prod.yml` | **no** — holds a real credential (SEC-010) |
| `s3.prod.json.example` | template for the above | yes |

The file must contain no keys beyond `identities` (and the fields shown in the template): SeaweedFS
parses it strictly and rejects unknown fields, so keep notes here rather than in the JSON.

## One-time production setup

On the server, in `/home/dev/Project-FastAPI`:

```bash
cp infra/seaweedfs/s3.prod.json.example infra/seaweedfs/s3.prod.json
openssl rand -hex 32            # paste as secretKey, replacing REPLACE_ME
chmod 600 infra/seaweedfs/s3.prod.json
```

`accessKey` / `secretKey` must match `S3_ACCESS_KEY` / `S3_SECRET_KEY` in `backend/.env`.

`s3.prod.json` is gitignored, so deployments (`git fetch` + `git checkout --detach <sha>`) leave it
untouched and the working tree stays clean. Do not create it as a directory by accident: if the file
is missing, the production bind mount refuses to start instead of creating a directory.
The deploy script also checks for a regular file before touching anything.

## Recover an existing directory mount

If storage logs say `s3.json: is a directory`, the old bind mount created a directory where
`s3.prod.json` should be. Run the following on the server with the backend container running.
This writes the storage identity using the backend's existing credentials, without printing them
or changing `backend/.env`. It preserves the directory as a backup and recreates only the broken
storage container, keeping its data volume. This is an explicit repair, separate from deployment.

```bash
cd /home/dev/Project-FastAPI
(
  set -eu
  umask 077
  test -d infra/seaweedfs/s3.prod.json
  config_tmp=$(mktemp "$PWD/infra/seaweedfs/s3.prod.json.repair.XXXXXX")
  trap 'rm -f -- "$config_tmp"' EXIT
  docker compose -f docker-compose.prod.yml exec -T backend python -c '
import json
from app.core.config import get_settings
s = get_settings()
assert s.s3_access_key and s.s3_secret_key, "S3 credentials must be configured"
print(json.dumps({"identities": [{"name": "tezfarmo-prod", "credentials": [{"accessKey": s.s3_access_key, "secretKey": s.s3_secret_key}], "actions": ["Admin", "Read", "Write", "List", "Tagging"]}]}))
' > "$config_tmp"
  backup_path="$PWD/infra/seaweedfs/s3.prod.json.directory-backup-$(date +%Y%m%d%H%M%S)"
  test ! -e "$backup_path"
  mv -T -- "$PWD/infra/seaweedfs/s3.prod.json" "$backup_path"
  mv -T -- "$config_tmp" "$PWD/infra/seaweedfs/s3.prod.json"
  docker compose -f docker-compose.prod.yml up -d --no-deps storage
)
docker compose -f docker-compose.prod.yml ps storage
docker compose -f docker-compose.prod.yml logs --tail=20 storage
```

Wait for the S3 server to start, then retry the profile image upload.

Changing the credential means rewriting both this file and `backend/.env`, then restarting
`storage` and `backend` — objects already stored are unaffected.
