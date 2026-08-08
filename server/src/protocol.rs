use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GamepadPacket {
    pub magic: u8,        // 0x47
    pub version: u8,
    pub player_id: u8,
    pub flags: u8,
    pub sequence: u32,
    pub buttons: u16,
    pub left_stick_x: i16,
    pub left_stick_y: i16,
    pub right_stick_x: i16,
    pub right_stick_y: i16,
    pub left_trigger: u8,
    pub right_trigger: u8,
    pub timestamp: u32,
}

impl GamepadPacket {
    pub const MAGIC: u8 = 0x47;
    pub const VERSION: u8 = 0x01;
    pub const SIZE: usize = 24;
}

// Bitmask for buttons (Matches Xbox Controller Layout)
pub mod buttons {
    pub const D_UP: u16 = 0x0001;
    pub const D_DOWN: u16 = 0x0002;
    pub const D_LEFT: u16 = 0x0004;
    pub const D_RIGHT: u16 = 0x0008;
    pub const START: u16 = 0x0010;
    pub const BACK: u16 = 0x0020;
    pub const L_THUMB: u16 = 0x0040;
    pub const R_THUMB: u16 = 0x0080;
    pub const L_SHOULDER: u16 = 0x0100;
    pub const R_SHOULDER: u16 = 0x0200;
    pub const GUIDE: u16 = 0x0400;
    pub const A: u16 = 0x1000;
    pub const B: u16 = 0x2000;
    pub const X: u16 = 0x4000;
    pub const Y: u16 = 0x8000;
}
