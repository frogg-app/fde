if [[ -n "${_FDE_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _FDE_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _FDE_ZSH_COMMAND_ACTIVE=0

function _fde_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _fde_precmd() {
  local command_status=$?
  if [[ "$_FDE_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _fde_osc633 "D;${command_status}"
    _FDE_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _fde_osc633 "A"
}

function _fde_preexec() {
  _FDE_ZSH_COMMAND_ACTIVE=1
  _fde_osc633 "B"
  _fde_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _fde_precmd
add-zsh-hook preexec _fde_preexec
