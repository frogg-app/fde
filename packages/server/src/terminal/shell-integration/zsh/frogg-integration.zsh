if [[ -n "${_FROGG_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _FROGG_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _FROGG_ZSH_COMMAND_ACTIVE=0

function _frogg_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _frogg_precmd() {
  local command_status=$?
  if [[ "$_FROGG_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _frogg_osc633 "D;${command_status}"
    _FROGG_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _frogg_osc633 "A"
}

function _frogg_preexec() {
  _FROGG_ZSH_COMMAND_ACTIVE=1
  _frogg_osc633 "B"
  _frogg_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _frogg_precmd
add-zsh-hook preexec _frogg_preexec
