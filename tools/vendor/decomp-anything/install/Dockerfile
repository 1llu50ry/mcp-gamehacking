# decomp.anything in Docker, for servers (docker-compose.yml in the repository does this for you).
# The same Linux as decomp.anything's WSL system on Windows (linux-base.sh). decomp.anything itself installs into the
# decomp user's home on the first start: keep /home/decomp on a volume, and updates it installs itself stay.
#
#   docker build -t decomp-anything .         (in this folder: Dockerfile, linux-base.sh, install.sh)
#   docker run -d --name decomp-anything -p 127.0.0.1:6464:6464 -e DECOMP_PORT=6464 \
#     -v decomp-anything-home:/home/decomp decomp-anything
#   docker exec decomp-anything decomp url    (the address that opens it, signed in)
#
# The compilers inside are x86 Linux programs: on Apple Silicon this runs as linux/amd64 (Rosetta or QEMU).
FROM --platform=linux/amd64 debian:trixie-slim

COPY linux-base.sh /tmp/linux-base.sh
RUN sh /tmp/linux-base.sh docker && rm /tmp/linux-base.sh
COPY install.sh /usr/local/share/decomp-anything/install.sh

USER decomp
WORKDIR /home/decomp
ENV LANG=C.UTF-8 DECOMP_RUNTIME=docker PATH=/home/decomp/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EXPOSE 6464
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m CMD curl -fsS "http://127.0.0.1:${DECOMP_PORT:-6464}/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/decomp-entrypoint"]
