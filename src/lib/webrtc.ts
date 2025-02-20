interface PeerConnection {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  stream?: MediaStream;
}

export class WebRTCService {
  private connections: Map<string, PeerConnection> = new Map();
  private localStream?: MediaStream;
  
  // Callback handlers
  public onPeerConnect?: (peerId: string) => void;
  public onPeerDisconnect?: (peerId: string) => void;
  public onSignalingMessage?: (targetPeerId: string, message: any) => void;
  
  constructor(private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' }
  ]) {}

  async initLocalStream(video = true, audio = true) {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video,
      audio
    });
    return this.localStream;
  }

  async createPeerConnection(peerId: string) {
    const pc = new RTCPeerConnection({ 
      iceServers: this.iceServers
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    const dataChannel = pc.createDataChannel('messageChannel');

    this.connections.set(peerId, { pc, dataChannel });

    // Handle ICE candidates
    pc.onicecandidate = event => {
      if (event.candidate && this.onSignalingMessage) {
        this.onSignalingMessage(peerId, {
          type: 'candidate',
          data: event.candidate
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && this.onPeerConnect) {
        this.onPeerConnect(peerId);
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState) && this.onPeerDisconnect) {
        this.onPeerDisconnect(peerId);
      }
    };

    // Handle remote stream
    pc.ontrack = event => {
      const conn = this.connections.get(peerId);
      if (conn) {
        conn.stream = event.streams[0];
      }
    };

    return pc;
  }

  async createOffer(peerId: string) {
    const pc = await this.createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(peerId: string, offer: RTCSessionDescriptionInit) {
    const pc = await this.createPeerConnection(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit) {
    const conn = this.connections.get(peerId);
    if (conn) {
      await conn.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const conn = this.connections.get(peerId);
    if (conn) {
      await conn.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  closeConnection(peerId: string) {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.pc.close();
      this.connections.delete(peerId);
      if (this.onPeerDisconnect) {
        this.onPeerDisconnect(peerId);
      }
    }
  }
}