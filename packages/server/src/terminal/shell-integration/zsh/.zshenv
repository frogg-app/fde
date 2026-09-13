typeset -g FROGG_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${FROGG_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${FROGG_ZSH_ZDOTDIR}"
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

source "${FROGG_SHELL_INTEGRATION_DIR}/frogg-integration.zsh"
