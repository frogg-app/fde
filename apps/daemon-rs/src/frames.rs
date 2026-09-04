//! Binary frame codec, ported from `@fde/protocol/binary-frames`.
//!
//! Wire format is `[opcode:u8][slot:u8][payload...]` for terminal streams and
//! file transfers alike. We decode far enough to route and log; payloads stay
//! opaque so frames can be relayed byte-for-byte.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalOpcode {
    Output = 0x01,
    Input = 0x02,
    Resize = 0x03,
    Snapshot = 0x04,
    Restore = 0x05,
}

// Names mirror the protocol's FileTransferOpcode exactly; renaming them to
// please the lint would make the mapping harder to check against the source.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileTransferOpcode {
    FileBegin = 0x10,
    FileChunk = 0x11,
    FileEnd = 0x12,
}

#[derive(Debug, PartialEq)]
pub enum Frame<'a> {
    Terminal {
        opcode: TerminalOpcode,
        slot: u8,
        payload: &'a [u8],
    },
    FileTransfer {
        opcode: FileTransferOpcode,
        slot: u8,
        payload: &'a [u8],
    },
}

impl TerminalOpcode {
    fn from_byte(value: u8) -> Option<Self> {
        Some(match value {
            0x01 => Self::Output,
            0x02 => Self::Input,
            0x03 => Self::Resize,
            0x04 => Self::Snapshot,
            0x05 => Self::Restore,
            _ => return None,
        })
    }
}

impl FileTransferOpcode {
    fn from_byte(value: u8) -> Option<Self> {
        Some(match value {
            0x10 => Self::FileBegin,
            0x11 => Self::FileChunk,
            0x12 => Self::FileEnd,
            _ => return None,
        })
    }
}

pub fn decode(bytes: &[u8]) -> Option<Frame<'_>> {
    if bytes.len() < 2 {
        return None;
    }
    let (opcode, slot, payload) = (bytes[0], bytes[1], &bytes[2..]);
    if let Some(opcode) = TerminalOpcode::from_byte(opcode) {
        return Some(Frame::Terminal {
            opcode,
            slot,
            payload,
        });
    }
    FileTransferOpcode::from_byte(opcode).map(|opcode| Frame::FileTransfer {
        opcode,
        slot,
        payload,
    })
}

pub fn encode_terminal(opcode: TerminalOpcode, slot: u8, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(2 + payload.len());
    bytes.push(opcode as u8);
    bytes.push(slot);
    bytes.extend_from_slice(payload);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_terminal_output_frame() {
        let encoded = encode_terminal(TerminalOpcode::Output, 7, b"hello");
        assert_eq!(encoded, vec![0x01, 7, b'h', b'e', b'l', b'l', b'o']);
        assert_eq!(
            decode(&encoded),
            Some(Frame::Terminal {
                opcode: TerminalOpcode::Output,
                slot: 7,
                payload: b"hello"
            })
        );
    }

    #[test]
    fn decodes_an_empty_payload_and_every_opcode() {
        for (byte, expected) in [
            (0x01, TerminalOpcode::Output),
            (0x02, TerminalOpcode::Input),
            (0x03, TerminalOpcode::Resize),
            (0x04, TerminalOpcode::Snapshot),
            (0x05, TerminalOpcode::Restore),
        ] {
            let bytes = [byte, 3];
            let frame = decode(&bytes).unwrap();
            assert_eq!(
                frame,
                Frame::Terminal {
                    opcode: expected,
                    slot: 3,
                    payload: &[]
                }
            );
        }
    }

    #[test]
    fn decodes_file_transfer_frames() {
        assert_eq!(
            decode(&[0x11, 2, 0xaa]),
            Some(Frame::FileTransfer {
                opcode: FileTransferOpcode::FileChunk,
                slot: 2,
                payload: &[0xaa]
            })
        );
    }

    #[test]
    fn rejects_short_and_unknown_frames() {
        assert!(decode(&[]).is_none());
        assert!(
            decode(&[0x01]).is_none(),
            "an opcode with no slot byte is incomplete"
        );
        assert!(decode(&[0x99, 0]).is_none());
    }
}
