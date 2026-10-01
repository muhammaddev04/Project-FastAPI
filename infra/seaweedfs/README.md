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
is missing when Compose starts the container, Docker creates an empty directory at that path and
SeaweedFS fails to start. The deploy script checks for a regular file before touching anything.

Changing the credential means rewriting both this file and `backend/.env`, then restarting
`storage` and `backend` — objects already stored are unaffected.
