# Arra Oracle v3 — Dev Container
# Works in VS Code locally and GitHub Codespaces
FROM node:22-bookworm-slim

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=$BUN_INSTALL/bin:$PATH

# Base tools used by the repo
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        git \
        tmux \
        unzip \
        sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install Bun ( pinned to 1.2.x line; upgrade by changing the tag )
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.2.10" \
    && ln -s $BUN_INSTALL/bin/bun /usr/local/bin/bun \
    && bun --version

# Install GitHub CLI for PR / issue workflow
RUN (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg) \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user matching the default Codespaces / VS Code user
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=1000
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && chown -R $USERNAME:$USERNAME /usr/local/bun

USER $USERNAME
WORKDIR /workspaces/arra-oracle-v3
