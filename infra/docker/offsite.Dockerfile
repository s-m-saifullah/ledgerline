# Tools for off-site backups: age encrypts, rclone uploads and downloads. Built on the server on first use
# (offsite-upload.sh) and on the owner's computer for restores. Versions are pinned on purpose.
FROM rclone/rclone:1.75.2
RUN apk add --no-cache age=~1.3
ENTRYPOINT []
