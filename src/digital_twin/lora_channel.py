"""LoRa Channel Simulator — E22-900M30S, 868 MHz, mesh"""
import random, time, json
from dataclasses import dataclass, field
from typing import List

@dataclass
class LoRaPacket:
    src: str; dst: str; payload: str; size: int
    sent_at: float; delivered: bool = True

@dataclass 
class LoRaNode:
    name: str; x: float = 0; z: float = 0; y: float = 0
    tx_queue: List[LoRaPacket] = field(default_factory=list)
    rx_log: List[LoRaPacket] = field(default_factory=list)
    packets_sent: int = 0; packets_lost: int = 0; bytes_sent: int = 0

class LoRaMesh:
    """868 MHz LoRa mesh between drones"""
    
    def __init__(self, bandwidth_kbps=62.5, latency_ms=50, packet_loss=0.03, range_km=8):
        self.bandwidth = bandwidth_kbps * 1000  # bps
        self.latency = latency_ms / 1000.0
        self.packet_loss = packet_loss
        self.range_m = range_km * 1000
        self.nodes = {}
        self.frequency = 868.0  # MHz
        
    def add_node(self, name, x=0, z=0, y=0):
        self.nodes[name] = LoRaNode(name=name, x=x, z=z, y=y)
        
    def update_position(self, name, x, z, y=0):
        if name in self.nodes:
            self.nodes[name].x = x
            self.nodes[name].z = z
            self.nodes[name].y = y
    
    def send(self, src_name, dst_name, payload, size=64):
        if src_name not in self.nodes: return False
        node = self.nodes[src_name]
        
        pkt = LoRaPacket(src=src_name, dst=dst_name, payload=payload, size=size, sent_at=time.time())
        node.tx_queue.append(pkt)
        node.packets_sent += 1
        node.bytes_sent += size
        
        # Check range
        if dst_name in self.nodes:
            src = self.nodes[src_name]; dst = self.nodes[dst_name]
            dist = ((src.x-dst.x)**2 + (src.z-dst.z)**2 + (src.y-dst.y)**2)**0.5
            if dist > self.range_m:
                pkt.delivered = False; node.packets_lost += 1; return False
        
        # Packet loss
        if random.random() < self.packet_loss:
            pkt.delivered = False; node.packets_lost += 1; return False
            
        # Latency + deliver
        time.sleep(self.latency * random.uniform(0.8, 1.2))
        if dst_name in self.nodes:
            self.nodes[dst_name].rx_log.append(pkt)
        
        return True
    
    def broadcast(self, src_name, payload, size=64):
        """Send to all nodes in range"""
        results = {}
        for dst_name in self.nodes:
            if dst_name != src_name:
                results[dst_name] = self.send(src_name, dst_name, payload, size)
        return results

    def stats(self):
        return {
            "frequency_mhz": self.frequency,
            "bandwidth_kbps": self.bandwidth/1000,
            "range_km": self.range_m/1000,
            "packet_loss": self.packet_loss,
            "nodes": {name: {
                "packets_sent": n.packets_sent,
                "packets_lost": n.packets_lost,
                "delivery_rate": 1 - n.packets_lost/max(n.packets_sent,1),
                "bytes_sent": n.bytes_sent,
            } for name, n in self.nodes.items()}
        }

# Global mesh instance
lora_mesh = LoRaMesh()
lora_mesh.add_node("Scout-1")
lora_mesh.add_node("Interceptor-1") 
lora_mesh.add_node("FPV-1")
lora_mesh.add_node("GroundStation")
