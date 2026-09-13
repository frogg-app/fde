# Daemon configuration

The daemon uses `$FDE_HOME/config.json`, normally `~/.fde/config.json`. It is a
validated JSON file, created with readable two-space indentation and private
permissions on first use. YAML is not a supported configuration format.

New files include editable defaults for the listener, MCP, browser tools, Git
process limits, merge archiving, terminal hooks, additional system prompt,
automatic updates, relay, pairing links, plugins, and logging. Optional provider
credentials and machine-specific paths are omitted.

To prettify an existing file without changing its settings:

```sh
fde config-format
# Or another daemon home:
fde config-format --home /path/to/fde-home
```

This explicitly writes the original JSON values, including supported legacy
fields, with two-space indentation and a final newline. Invalid configuration is
left untouched. Ordinary config reads do not rewrite existing files or add new
defaults; this avoids background readers overwriting another process's edits.
Do not edit the same file concurrently with formatting or other config writes.

For example, these supported settings can be added to an existing config,
merging them into the corresponding objects while preserving existing values:

```json
{
  "version": 1,
  "daemon": {
    "listen": "0.0.0.0:9999",
    "mcp": { "enabled": true, "injectIntoAgents": false },
    "browserTools": { "enabled": false },
    "git": { "maxProcessesPerSecond": 2048, "maxProcessConcurrency": 8 },
    "autoArchiveAfterMerge": false,
    "enableTerminalAgentHooks": false,
    "appendSystemPrompt": "",
    "autoUpdate": {
      "enabled": false,
      "channel": "stable",
      "checkIntervalHours": 24,
      "quietHours": null
    },
    "relay": { "enabled": false }
  },
  "pluginsEnabled": false,
  "plugins": {},
  "log": { "level": "info", "format": "json" }
}
```

The listener resolves in this order: `--listen`, `FDE_LISTEN`, `daemon.listen`,
then `0.0.0.0:$PORT` (port 9999 if `PORT` is absent). Numeric listen targets such
as `9999`, and targets without a hostname such as `:9999`, also bind all IPv4
interfaces. Explicit addresses, IPv6 targets, and Unix sockets retain their
meaning. Clients connect to the machine's actual address, not `0.0.0.0`.

An existing `"listen": "127.0.0.1:9999"` is explicit configuration and is preserved
on upgrade. Change it to `"0.0.0.0:9999"` and run `fde restart` to allow LAN
connections. Binding changes require restart; `fde reload` reports other fields
that require restart and those controlled by launch overrides.

`fde install-service` honors `--listen` and `FDE_LISTEN`. Without either, the
installed service reads `daemon.listen` on each start, so later config edits
remain effective. `--home` takes precedence over `FDE_HOME`. Previously installed
services may still have an explicit listener in their service definition;
reinstall the service without a listen override to return control to config.json.
