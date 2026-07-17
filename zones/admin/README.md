# Admin zone

The `admin` Incus container runs the Estate operations dashboard on port 3000 and asciinema server on port 4000. Asciinema and PostgreSQL run under Docker Compose; the Bun/SvelteKit dashboard runs as `sb-dashboard.service`.

On first use, open asciinema on port 4000 and create the production account. The first account becomes the instance administrator. With no SMTP configured, retrieve its passwordless login link with:

```sh
cd /opt/asciinema
docker compose logs asciinema | grep 'url from email'
```

> **Known risk:** stream-token provisioning is manual for now. Create an account for each participant in the web UI (or read its login link from `docker compose logs`), then put that stream token into host-agent state. Raw `.cast` fallback recordings remain in each participant container under `/var/log/sessions/`.
