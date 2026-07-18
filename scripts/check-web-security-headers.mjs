import { readFile } from "node:fs/promises";

const [source, edgeSource, dockerfile, securityTxt, compose, tlsCompose] = await Promise.all([
  readFile("docker/nginx.conf", "utf8"),
  readFile("docker/nginx-edge.conf", "utf8"),
  readFile("Dockerfile", "utf8"),
  readFile("docker/security.txt", "utf8"),
  readFile("docker-compose.production.yml", "utf8"),
  readFile("docker-compose.tls.yml", "utf8"),
]);
const requiredDirectives = [
  [
    "Content-Security-Policy",
    /add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'" always;/,
  ],
  [
    "Permissions-Policy",
    /add_header Permissions-Policy "camera=\(\), geolocation=\(\), microphone=\(\), payment=\(\), usb=\(\)" always;/,
  ],
  [
    "Cross-Origin-Opener-Policy",
    /add_header Cross-Origin-Opener-Policy "same-origin" always;/,
  ],
  [
    "Cross-Origin-Resource-Policy",
    /add_header Cross-Origin-Resource-Policy "same-origin" always;/,
  ],
  [
    "X-Content-Type-Options",
    /add_header X-Content-Type-Options "nosniff" always;/,
  ],
  ["X-Frame-Options", /add_header X-Frame-Options "DENY" always;/],
  ["Referrer-Policy", /add_header Referrer-Policy "no-referrer" always;/],
  [
    "X-Permitted-Cross-Domain-Policies",
    /add_header X-Permitted-Cross-Domain-Policies "none" always;/,
  ],
  ["X-Request-ID", /add_header X-Request-ID \$request_id always;/],
  ["client_header_timeout", /client_header_timeout 15s;/],
  ["client_body_timeout", /client_body_timeout 60s;/],
  ["keepalive_timeout", /keepalive_timeout 5s;/],
  ["send_timeout", /send_timeout 60s;/],
  ["unprivileged pid path", /pid \/tmp\/nginx\.pid;/],
  [
    "unprivileged client body path",
    /client_body_temp_path \/tmp\/client_body;/,
  ],
  ["unprivileged proxy temp path", /proxy_temp_path \/tmp\/proxy;/],
  ["unprivileged FastCGI temp path", /fastcgi_temp_path \/tmp\/fastcgi;/],
  ["unprivileged SCGI temp path", /scgi_temp_path \/tmp\/scgi;/],
  ["unprivileged uWSGI temp path", /uwsgi_temp_path \/tmp\/uwsgi;/],
  [
    "query-free access log",
    /log_format watchbridge_safe '\$remote_addr \[\$time_local\] "\$request_method \$uri \$server_protocol" \$status \$body_bytes_sent \$request_time \$request_id';/,
  ],
  ["safe access log destination", /access_log \/dev\/stdout watchbridge_safe;/],
  [
    "security.txt route",
    /location = \/\.well-known\/security\.txt \{\s+alias \/etc\/nginx\/security\.txt;\s+default_type text\/plain;/,
  ],
  [
    "server-scope cache policy",
    /map \$uri \$watchbridge_cache_control \{\s+default "no-store";\s+~\^\/assets\/ "public, max-age=31536000, immutable";\s+=\/\.well-known\/security\.txt "public, max-age=86400";\s+\}[\s\S]*add_header Cache-Control \$watchbridge_cache_control always;/,
  ],
  [
    "immutable assets route",
    /location \^~ \/assets\/ \{\s+try_files \$uri =404;\s+\}/,
  ],
  [
    "fresh application shell route",
    /location = \/index\.html \{\s+try_files \$uri =404;\s+\}/,
  ],
];

const missing = requiredDirectives
  .filter(([, pattern]) => !pattern.test(source))
  .map(([header]) => header);

for (const directive of [
  "proxy_connect_timeout 5s;",
  "proxy_send_timeout 60s;",
  "proxy_read_timeout 300s;",
]) {
  const occurrences = source.split(directive).length - 1;
  if (occurrences !== 3)
    missing.push(`${directive} (expected in every API proxy location)`);
}

if (
  !/COPY docker\/security\.txt \/etc\/nginx\/security\.txt/.test(dockerfile)
) {
  missing.push("security.txt image copy");
}
if (
  !/^Contact: https:\/\/github\.com\/Yunushan\/watchbridge-sync\/security\/advisories\/new$/m.test(
    securityTxt,
  ) ||
  !/^Policy: https:\/\/github\.com\/Yunushan\/watchbridge-sync\/security\/policy$/m.test(
    securityTxt,
  ) ||
  !/^Preferred-Languages: en$/m.test(securityTxt)
) {
  missing.push("valid security.txt contact, policy, or language");
}
const expiry = /^Expires: (.+)$/m.exec(securityTxt)?.[1];
if (
  !expiry ||
  !Number.isFinite(Date.parse(expiry)) ||
  Date.parse(expiry) <= Date.now()
) {
  missing.push("future security.txt expiry");
}
if (
  !/web:[\s\S]*?tmpfs:\s*\n\s*- \/tmp[\s\S]*?security_opt:/m.test(compose) ||
  /web:[\s\S]*?- \/var\/(?:cache\/nginx|run)/m.test(compose)
) {
  missing.push("web-only /tmp writable mount");
}

for (const [name, pattern] of [
  ["TLS certificate secret", /ssl_certificate \/run\/secrets\/watchbridge_tls_certificate\.pem;/],
  ["TLS private-key secret", /ssl_certificate_key \/run\/secrets\/watchbridge_tls_private_key\.pem;/],
  ["modern TLS protocols", /ssl_protocols TLSv1\.2 TLSv1\.3;/],
  ["HTTPS-only HSTS", /add_header Strict-Transport-Security "max-age=31536000" always;/],
  ["HTTP redirect", /return 308 https:\/\/\$host\$request_uri;/],
  ["unprivileged edge health route", /location = \/edge-healthz \{\s+access_log off;\s+return 204;/],
  ["TLS proxy to private web service", /proxy_pass http:\/\/web:8080;/],
  ["HTTPS forwarding marker", /proxy_set_header X-Forwarded-Proto https;/],
  ["TLS edge body limit parity", /listen 8443 ssl;\s+server_name _;\s+client_max_body_size 10m;/],
]) {
  if (!pattern.test(edgeSource)) missing.push(name);
}
for (const directive of [
  "client_body_temp_path /tmp/client_body;",
  "proxy_temp_path /tmp/proxy;",
  "fastcgi_temp_path /tmp/fastcgi;",
  "scgi_temp_path /tmp/scgi;",
  "uwsgi_temp_path /tmp/uwsgi;",
]) {
  if (!edgeSource.includes(directive)) missing.push(`edge ${directive}`);
}
if (
  !/edge:[\s\S]*?target: edge[\s\S]*?condition: service_healthy[\s\S]*?read_only: true[\s\S]*?cap_drop:\s*\n\s*- ALL/m.test(
    tlsCompose,
  ) ||
  !/WATCHBRIDGE_TLS_CERTIFICATE_PATH/.test(tlsCompose) ||
  !/WATCHBRIDGE_TLS_PRIVATE_KEY_PATH/.test(tlsCompose) ||
  !/watchbridge_tls_certificate\.pem/.test(tlsCompose) ||
  !/watchbridge_tls_private_key\.pem/.test(tlsCompose)
) {
  missing.push("hardened TLS edge Compose profile with runtime certificate secrets");
}

if (missing.length > 0) {
  console.error(
    `Web proxy hardening check failed; missing or weakened: ${missing.join(", ")}.`,
  );
  process.exitCode = 1;
} else {
  console.log("Web proxy hardening check passed.");
}
