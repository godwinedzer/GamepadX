mod protocol;
mod controller;

use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use crate::protocol::GamepadPacket;
use crate::controller::VirtualController;

struct PlayerState {
    last_packet: GamepadPacket,
    last_seen: Instant,
    controller: VirtualController,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎮 ZapGamepad Server Starting...");

    // Auto-detect Local IP
    let my_local_ip = match local_ip_address::local_ip() {
        Ok(ip) => ip.to_string(),
        Err(_) => "127.0.0.1".to_string(),
    };
    println!("📡 Local IP Detected: {}", my_local_ip);

    // Generate QR Code for easy IP entry
    if let Ok(code) = qrcode::QrCode::new(&my_local_ip) {
        let qr_image = code.render()
            .light_color(' ')
            .dark_color('█')
            .build();
        println!("\nScan this to copy your PC IP address:\n{}", qr_image);
    }

    println!("📡 Listening for UDP packets on port 8888");

    // Disable Enhance Pointer Precision for raw mouse input consistency
    controller::disable_mouse_acceleration();

    // Spawn Ctrl+C listener for graceful cleanup
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        println!("\n🛑 Graceful shutdown signal received...");
        controller::restore_mouse_acceleration();
        std::process::exit(0);
    });

    // Bind UDP Socket
    let socket = UdpSocket::bind("0.0.0.0:8888").await?;

    // Bounded Channel (Size 128) - No Mutex Contention
    let (tx, rx) = crossbeam_channel::bounded::<GamepadPacket>(128);

    // --- LOOP 1: UDP Receiver Thread ---
    let tx_net = tx.clone();
    let rx_net = rx.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        loop {
            if let Ok((len, _addr)) = socket.recv_from(&mut buf).await {
                if len == GamepadPacket::SIZE {
                    // Safe unaligned read to prevent alignment panics
                    let packet: GamepadPacket = bytemuck::pod_read_unaligned(&buf[..GamepadPacket::SIZE]);

                    if packet.magic == GamepadPacket::MAGIC {
                        // Bounded Channel with Overwrite Drop Strategy
                        match tx_net.try_send(packet) {
                            Ok(_) => {}
                            Err(crossbeam_channel::TrySendError::Full(_)) => {
                                // Evict oldest packet to make room for latest snapshot
                                let _ = rx_net.try_recv();
                                let _ = tx_net.try_send(packet);
                            }
                            Err(_) => {}
                        }
                    }
                }
            }
        }
    });

    // --- LOOP 2: 120Hz Thread-Local Injection Loop ---
    let mut players: HashMap<u8, PlayerState> = HashMap::new();
    let mut interval = tokio::time::interval(Duration::from_millis(8)); 

    loop {
        interval.tick().await;
        
        // Drain all pending packets from the channel (stale-state overwrite)
        while let Ok(packet) = rx.try_recv() {
            let entry = players.entry(packet.player_id).or_insert_with(|| {
                println!("🆕 New Player Linked: ID {}", packet.player_id);
                PlayerState {
                    last_packet: packet,
                    last_seen: Instant::now(),
                    controller: VirtualController::new(),
                }
            });

            // Keep only the latest sequence ID packet (drop stale/out-of-order packets)
            if packet.sequence > entry.last_packet.sequence || packet.sequence == 0 {
                let old_buttons = entry.last_packet.buttons;
                entry.last_packet = packet;
                entry.last_seen = Instant::now();

                if packet.buttons != old_buttons {
                    println!("📥 Input Changed: Buttons: {:04X} | Seq: {}", packet.buttons, packet.sequence);
                }
            }
        }
        
        let now = Instant::now();
        for (_id, state) in players.iter_mut() {
            if now.duration_since(state.last_seen) > Duration::from_millis(100) {
                state.controller.neutralize();
            } else {
                state.controller.update(&state.last_packet);
            }
        }
    }
}
