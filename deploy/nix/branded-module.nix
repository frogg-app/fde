# Each instance gets its identity from the package built with brandSource.
{ config, lib, pkgs, ... }:
let
  instances = config.services.fde.instances;
  enabled = lib.filterAttrs (_: instance: instance.enable) instances;
in {
  options.services.fde.instances = lib.mkOption {
    default = { };
    description = "Independent branded daemon distributions.";
    type = lib.types.attrsOf (lib.types.submodule ({ config, ... }: {
      options = {
        enable = lib.mkEnableOption "this branded daemon";
        package = lib.mkOption { type = lib.types.package; description = "Package built with deploy/nix/package.nix and a pinned brandSource."; };
        user = lib.mkOption { type = lib.types.str; default = config.package.brand.id; };
        dataDir = lib.mkOption { type = lib.types.str; default = "/var/lib/${config.package.brand.id}"; };
        port = lib.mkOption { type = lib.types.port; default = config.package.brand.daemonPort; };
        listenAddress = lib.mkOption { type = lib.types.str; default = "0.0.0.0"; };
        openFirewall = lib.mkOption { type = lib.types.bool; default = false; };
        environment = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
        environmentFile = lib.mkOption { type = lib.types.nullOr lib.types.path; default = null; description = "Runtime secret file; never put credentials in the brand manifest."; };
      };
    }));
  };
  config = lib.mkIf (enabled != { }) {
    assertions = [ {
      assertion = builtins.length (lib.unique (map (c: c.package.brand.serviceName) (builtins.attrValues enabled))) == builtins.length (builtins.attrValues enabled);
      message = "Branded daemon instances must have different service identities.";
    } ];
    users.users = lib.mapAttrs' (_: c: lib.nameValuePair c.user { isSystemUser = true; group = c.user; home = c.dataDir; }) enabled;
    users.groups = lib.mapAttrs' (_: c: lib.nameValuePair c.user { }) enabled;
    systemd.services = lib.mapAttrs' (_: c:
      let b = c.package.brand; in lib.nameValuePair b.serviceName {
        description = "${b.name} daemon";
        wantedBy = [ "multi-user.target" ]; after = [ "network.target" ];
        environment = c.environment // { "${b.envPrefix}_HOME" = c.dataDir; PASEO_LISTEN = "${c.listenAddress}:${toString c.port}"; };
        preStart = ''
          owner=${lib.escapeShellArg "${b.id}:${b.applicationId}"}
          marker=${lib.escapeShellArg "${c.dataDir}/.brand-identity"}
          if test -e "$marker" && test "$(cat "$marker")" != "$owner"; then
            echo 'State directory belongs to another product' >&2; exit 1
          fi
          printf '%s\n' "$owner" > "$marker"
        '';
        serviceConfig = {
          User = c.user; Group = c.user;
          ExecStart = "${c.package}/bin/${b.cliName}-server";
          StateDirectory = b.id;
          ReadWritePaths = [ c.dataDir ];
          Restart = "on-failure"; RestartSec = 5; KillSignal = "SIGTERM"; TimeoutStopSec = 15;
        } // lib.optionalAttrs (c.environmentFile != null) { EnvironmentFile = c.environmentFile; };
      }) enabled;
    systemd.tmpfiles.rules = map (c: "d ${c.dataDir} 0700 ${c.user} ${c.user} - -") (builtins.attrValues enabled);
    environment.systemPackages = map (c: c.package) (builtins.attrValues enabled);
    networking.firewall.allowedTCPPorts = map (c: c.port) (builtins.attrValues (lib.filterAttrs (_: c: c.openFirewall) enabled));
  };
}
