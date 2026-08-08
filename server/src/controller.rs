use vigem_client::{Client, Xbox360Wired};
use crate::protocol::{GamepadPacket, buttons};
use enigo::{Enigo, MouseControllable, KeyboardControllable, Key};
use std::time::Instant;

// =================================================
// WIN32 API - MOUSE ACCELERATION CONTROL
// =================================================
#[link(name = "user32")]
extern "system" {
    fn SystemParametersInfoA(uiAction: u32, uiParam: u32, pvParam: *mut std::ffi::c_void, fWinIni: u32) -> i32;
}

const SPI_GETMOUSE: u32 = 3;
const SPI_SETMOUSE: u32 = 4;

static mut ORIGINAL_MOUSE_PARAMS: [i32; 3] = [0; 3];
static mut ACCEL_DISABLED: bool = false;

pub fn disable_mouse_acceleration() {
    unsafe {
        if ACCEL_DISABLED {
            return;
        }
        let res = SystemParametersInfoA(SPI_GETMOUSE, 0, ORIGINAL_MOUSE_PARAMS.as_mut_ptr() as *mut _, 0);
        if res != 0 {
            let mut new_params: [i32; 3] = [0, 0, 0]; // thresholds = 0, acceleration = 0
            SystemParametersInfoA(SPI_SETMOUSE, 0, new_params.as_mut_ptr() as *mut _, 0);
            ACCEL_DISABLED = true;
            println!("🎯 Enhance Pointer Precision programmatically DISABLED for raw linear gaming aim.");
        }
    }
}

pub fn restore_mouse_acceleration() {
    unsafe {
        if !ACCEL_DISABLED {
            return;
        }
        SystemParametersInfoA(SPI_SETMOUSE, 0, ORIGINAL_MOUSE_PARAMS.as_mut_ptr() as *mut _, 0);
        ACCEL_DISABLED = false;
        println!("🎯 Enhance Pointer Precision RESTORED to Windows original state.");
    }
}

// =================================================
// VIRTUAL CONTROLLER
// =================================================
pub struct VirtualController {
    device: Xbox360Wired<Client>,
    enigo: Enigo,
    last_buttons: u16,
    last_mouse_mode: bool,
    last_update: Instant,
    mouse_accum_x: f32,
    mouse_accum_y: f32,
}

impl VirtualController {
    pub fn new() -> Self {
        let client = Client::connect().expect("Failed to connect to ViGEmBus");
        let mut device = Xbox360Wired::new(client, vigem_client::TargetId::XBOX360_WIRED);
        device.plugin().expect("Failed to plugin virtual controller");
        device.wait_ready().expect("Virtual controller not ready");
        Self { 
            device,
            enigo: Enigo::new(),
            last_buttons: 0,
            last_mouse_mode: false,
            last_update: Instant::now(),
            mouse_accum_x: 0.0,
            mouse_accum_y: 0.0,
        }
    }

    pub fn update(&mut self, packet: &GamepadPacket) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_update).as_secs_f32().min(0.1);
        self.last_update = now;

        // Flags bit 0: Mouse Emulation Mode
        let mouse_mode = (packet.flags & 0x01) != 0;
        if self.last_mouse_mode && !mouse_mode {
            self.release_dpad_keys();
        }

        // --- KEYBOARD EMULATION (D-Pad to Arrow Keys) ---
        let current = packet.buttons;
        let last = self.last_buttons;

        if mouse_mode {
            let dpad_map = [
                (buttons::D_UP, Key::UpArrow),
                (buttons::D_DOWN, Key::DownArrow),
                (buttons::D_LEFT, Key::LeftArrow),
                (buttons::D_RIGHT, Key::RightArrow),
            ];

            for (mask, key) in dpad_map {
                let is_pressed = (current & mask) != 0;
                let was_pressed = (last & mask) != 0;

                if is_pressed && !was_pressed {
                    self.enigo.key_down(key);
                } else if !is_pressed && was_pressed {
                    self.enigo.key_up(key);
                }
            }
        }
        self.last_buttons = current;
        self.last_mouse_mode = mouse_mode;

        // --- CONTROLLER REPORT ---
        let mut report = vigem_client::XGamepad::default();
        report.buttons.raw = packet.buttons;
        report.thumb_lx = packet.left_stick_x;
        report.thumb_ly = packet.left_stick_y;
        
        report.left_trigger = packet.left_trigger;
        report.right_trigger = packet.right_trigger;

        if mouse_mode {
            // --- MOUSE EMULATION (Right Stick) ---
            let sensitivity = 500.0; // Pixels per second at full stick deflection
            let deadzone = 4000.0; 
            
            let rx = packet.right_stick_x as f32;
            let ry = packet.right_stick_y as f32; 
            let mag = (rx * rx + ry * ry).sqrt();

            if mag > deadzone {
                let normalized_mag = (mag - deadzone) / (32768.0 - deadzone);
                let angle = ry.atan2(rx);
                
                let speed = normalized_mag * sensitivity * dt;
                
                let move_x = angle.cos() * speed;
                let move_y = -angle.sin() * speed; // Invert Y for screen space
                
                self.mouse_accum_x += move_x;
                self.mouse_accum_y += move_y;
                
                let step_x = self.mouse_accum_x.trunc() as i32;
                let step_y = self.mouse_accum_y.trunc() as i32;
                
                if step_x != 0 || step_y != 0 {
                    self.enigo.mouse_move_relative(step_x, step_y);
                    self.mouse_accum_x -= step_x as f32;
                    self.mouse_accum_y -= step_y as f32;
                }
            } else {
                self.mouse_accum_x = 0.0;
                self.mouse_accum_y = 0.0;
            }

            report.thumb_rx = 0;
            report.thumb_ry = 0;
        } else {
            // --- NATIVE CONTROLLER RIGHT STICK ---
            report.thumb_rx = packet.right_stick_x;
            report.thumb_ry = packet.right_stick_y;
            
            self.mouse_accum_x = 0.0;
            self.mouse_accum_y = 0.0;
        }

        let _ = self.device.update(&report);
    }

    pub fn neutralize(&mut self) {
        self.release_dpad_keys();

        self.last_buttons = 0;
        self.last_mouse_mode = false;
        self.mouse_accum_x = 0.0;
        self.mouse_accum_y = 0.0;
        self.last_update = Instant::now();
        let _ = self.device.update(&vigem_client::XGamepad::default());
    }

    fn release_dpad_keys(&mut self) {
        self.enigo.key_up(Key::UpArrow);
        self.enigo.key_up(Key::DownArrow);
        self.enigo.key_up(Key::LeftArrow);
        self.enigo.key_up(Key::RightArrow);
    }
}

