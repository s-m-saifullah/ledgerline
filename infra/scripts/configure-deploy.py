"""Provision a dedicated deployment key and private owner environment, without printing secrets.

Run once from the owner's computer after install-vps.sh. Uses an SSH alias you already trust
(for example one defined in ~/.ssh/config). Nothing here is specific to one person or host:
every value is an argument.

    python3 configure-deploy.py --repo OWNER/ledgerline --ssh-alias my-server \
        --domain ledgerline.example.com --owner-email you@example.com
"""
import argparse
import json
import pathlib
import shlex
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("--repo", required=True, help="GitHub repository that holds the deploy secrets, OWNER/NAME")
parser.add_argument("--ssh-alias", required=True, help="trusted SSH alias of an administrator account on the server")
parser.add_argument("--domain", required=True, help="public domain, for example ledgerline.example.com")
parser.add_argument("--owner-email", required=True, help="email of the first (owner) account")
parser.add_argument("--owner-name", default="Owner", help="display name of the owner account")
parser.add_argument("--deploy-user", default="ledgerline", help="Linux user that runs the stack")
parser.add_argument("--deploy-dir", default="/opt/ledgerline", help="install directory on the server")
parser.add_argument("--image-repository", help="image repository without -api/-web, default ghcr.io/<repo in lowercase>")
parser.add_argument("--github-environment", help="store the secrets in this GitHub environment instead of the repository")
args = parser.parse_args()
image_repository = args.image_repository or f"ghcr.io/{args.repo.lower()}"


def run(command, **kwargs):
    return subprocess.run(command, check=True, capture_output=True, text=True, **kwargs).stdout


def remote(command, **kwargs):
    return run(["ssh", "-o", "BatchMode=yes", args.ssh_alias, shlex.join(command)], **kwargs)


settings = dict(line.split(" ", 1) for line in run(["ssh", "-G", args.ssh_alias]).splitlines() if " " in line)
host = settings["hostname"]
host_key = remote(["sudo", "-n", "cat", "/etc/ssh/ssh_host_ed25519_key.pub"]).strip()
known_hosts = f"{host} {host_key}\n"
with tempfile.TemporaryDirectory(prefix="ledgerline-deploy-") as directory:
    key = pathlib.Path(directory) / "id_ed25519"
    run(["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "ledgerline-github-actions", "-f", str(key)])
    public_key = "restrict " + key.with_suffix(".pub").read_text()
    remote(
        ["sudo", "-n", "-u", args.deploy_user, "sh", "-c", f"umask 077; cat >> /home/{args.deploy_user}/.ssh/authorized_keys"],
        input=public_key,
    )
    for name, value in {"VPS_HOST": host, "VPS_KNOWN_HOSTS": known_hosts, "VPS_SSH_KEY": key.read_text()}.items():
        command = ["gh", "secret", "set", name, "--repo", args.repo]
        if args.github_environment:
            command += ["--env", args.github_environment]
        run(command, input=value)

script = r'''
import json, os, pathlib, secrets, sys
config = json.loads(sys.argv[1])
p = pathlib.Path(config["dir"]) / ".env"
if p.exists():
    print("Existing production environment retained.")
else:
    db = secrets.token_hex(24)
    env = {
        "NODE_ENV": "production",
        "APP_URL": "https://" + config["domain"],
        "POSTGRES_USER": "ledgerline",
        "POSTGRES_PASSWORD": db,
        "POSTGRES_DB": "ledgerline",
        "DATABASE_URL": f"postgresql://ledgerline:{db}@db:5432/ledgerline",
        "BETTER_AUTH_SECRET": secrets.token_hex(48),
        "OWNER_EMAIL": config["email"],
        "OWNER_NAME": config["name"],
        "OWNER_PASSWORD": secrets.token_urlsafe(24),
        "API_IMAGE": config["image"] + "-api:v0.0.1",
        "WEB_IMAGE": config["image"] + "-web:v0.0.1",
    }
    descriptor = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as f:
        f.write("\n".join(f"{k}={v}" for k, v in env.items()) + "\n")
    print("Private owner environment created.")
'''
config = json.dumps(
    {"dir": args.deploy_dir, "domain": args.domain, "email": args.owner_email, "name": args.owner_name, "image": image_repository}
)
remote(["sudo", "-n", "-u", args.deploy_user, "python3", "-c", script, config])
print(f"Dedicated SSH key configured; GitHub secrets saved. Production credentials remain only in {args.deploy_dir}/.env.")
