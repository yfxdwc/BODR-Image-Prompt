# Installation and Runtime Guide

This guide keeps operational details out of the main README.

## Requirements

For normal release installs:

- Python 3.10+
- `curl` or a browser to download the installer

For source/development installs:

- Python 3.10+
- Node.js 20+ recommended
- npm

Normal release installs do not require Node.js because tagged release assets include the built frontend.

## Platform support

- macOS and Linux are the primary supported local-install targets today.
- Windows can run the app stack through **WSL 2** using the same commands as Linux.
- Native Windows PowerShell/CMD is not a supported quick-start path yet because the current helper scripts are Bash scripts and assume Unix-style virtualenv paths such as `.venv/bin/activate`. Native Windows support should use equivalent PowerShell scripts or a Docker/Compose path in a future pass.

If the server starts in WSL but your Windows browser cannot open `http://127.0.0.1:8000/`, stop the server with Ctrl-C and run:

```bash
BODR-Image-Prompt start --host 0.0.0.0
```

Then open <http://localhost:8000/>. Binding to `0.0.0.0` can expose the app outside WSL, so use it only on a trusted machine/network.

## Install the latest release

```bash
curl -fsSL https://raw.githubusercontent.com/yfxdwc/BODR-Image-Prompt/main/scripts/install.sh | bash
BODR-Image-Prompt start
```

`BODR-Image-Prompt start` runs the local server in the current terminal. Keep it open, then visit <http://127.0.0.1:8000/> in your browser. Press `Ctrl-C` in that terminal to stop the server.

## Install a specific release

```bash
curl -fsSL https://raw.githubusercontent.com/yfxdwc/BODR-Image-Prompt/main/scripts/install.sh | bash -s -- --version v0.7.4-beta
BODR-Image-Prompt start
```

The selected release must have matching GitHub Release assets:

- `BODR-Image-Prompt-<version>.tar.gz`
- `BODR-Image-Prompt-<version>.tar.gz.sha256`
- `BODR-Image-Prompt-<version>.manifest.json`

The installer verifies SHA256 before switching `app/current` to the new version.

## Data locations

The installer keeps replaceable app code under:

```text
~/.BODR-Image-Prompt/app/versions/<version>
```

Your private prompt library defaults to:

```text
~/BODRImagePrompt
```

That data directory is separate from app code, so updates or rollbacks should not overwrite your private SQLite database or images.

## Sample data

Sample data is optional. Install a starter sample library only if you want demo references in a fresh local library:

```bash
BODR-Image-Prompt sample-data en
```

Other languages:

```bash
BODR-Image-Prompt sample-data zh_hans
BODR-Image-Prompt sample-data zh_hant
```

Larger Traditional Chinese sample package:

```bash
BODR-Image-Prompt sample-data zh_hant awesome-gpt-image-2
```

## Health check

```bash
BODR-Image-Prompt doctor
```

## Update and rollback

Update to the latest release:

```bash
BODR-Image-Prompt update
```

Install or switch to a specific version:

```bash
BODR-Image-Prompt update --version v0.7.4-beta
```

Rollback to the previous installed version:

```bash
BODR-Image-Prompt rollback
```

## macOS launchd service

Install/manage a user launchd service for a long-running local instance:

```bash
BODR-Image-Prompt service install --host 127.0.0.1 --port 8000
BODR-Image-Prompt service status
BODR-Image-Prompt service restart
BODR-Image-Prompt service stop
BODR-Image-Prompt service start
BODR-Image-Prompt service uninstall
```

Service install refuses to overwrite an existing plist for the same label unless you pass `--replace`, so a managed service is not silently replaced during reinstall.

Use `--host 0.0.0.0` only when you intentionally want LAN access and understand the firewall exposure.

## PATH fallback

If the `BODR-Image-Prompt` command is not found, add `~/.local/bin` to your shell `PATH`, or use the fallback command printed by the installer:

```bash
~/.BODR-Image-Prompt/app/current/scripts/appctl.sh start
```

## Uninstall

Keep your private library and uninstall only the app:

```bash
BODR-Image-Prompt uninstall
```

This removes the app files but keeps your prompts and images in `~/BODRImagePrompt`, so you can reinstall later.

Delete everything, including your private library, only when you are sure:

```bash
BODR-Image-Prompt uninstall --delete-library
```

If you run that from a script or non-interactive shell, add `--yes`:

```bash
BODR-Image-Prompt uninstall --delete-library --yes
```
