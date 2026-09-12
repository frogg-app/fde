typeset -g FDE_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${FDE_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${FDE_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${FDE_SHELL_INTEGRATION_DIR}/fde-integration.zsh"
