# Branding implementation record

The shared branding contract supplies product identity, generated artwork, UI
labels, daemon/CLI names, storage roots and distribution metadata. See the
[current guide](branding.md) and [manifest reference](branding-reference.md).

FDE 0.6 uses Electron for production desktop packaging and separate Node daemon
artifacts. The old native-shell overlays and Rust backend are inactive references;
they are not part of current release acceptance. The official app uses the FDE
identity, default daemon port 9999 and `fde://` links. Existing tested Electron
profile continuity is documented in [upgrade notes](upgrade-0.6.md).

Custom infrastructure is explicit. No relay endpoint is supplied by default;
configure a relay you operate or use direct/SSH connections. Package metadata,
artifact identity and checksums must match the selected product and version.

Build/typecheck evidence proves generated contracts and compilation. It does not
prove interactive installation, signed production updates, physical mobile
behavior or store submission. No iOS store release pipeline is present. Record
platform evidence with the release rather than carrying forward superseded native
shell test counts or deployment claims.
