interface PeerConnection {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  stream?: MediaStream;
  pendingCandidates: RTCIceCandidate[];
  stats?: {
    selectedCandidate?: RTCIceCandidate;
    localCandidates: RTCIceCandidate[];
    remoteCandidates: RTCIceCandidate[];
    connectionStats?: RTCIceConnectionState;
  };
}

export class WebRTCService {
  private connections: Map<string, PeerConnection> = new Map();
  private localStream?: MediaStream;
  private rtcConfiguration: RTCConfiguration;
  
  // Callback handlers
  public onPeerConnect?: (peerId: string) => void;
  public onPeerDisconnect?: (peerId: string) => void;
  public onSignalingMessage?: (targetPeerId: string, message: any) => void;
  public onStatsUpdate?: (peerId: string, stats: PeerConnection['stats']) => void;
  public onTrack?: (stream: MediaStream) => void;
  
  constructor(private iceServers: RTCIceServer[] = [
    // Google's public STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },


  ]) {
    // Set up WebRTC configuration
    this.rtcConfiguration = {
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10
    };
  }

  async initLocalStream(stream?: MediaStream) {
    if (stream) {
      this.localStream = stream;
      return stream;
    }

    if (this.localStream) {
      return this.localStream;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideo = devices.some(device => device.kind === 'videoinput');
      const hasAudio = devices.some(device => device.kind === 'audioinput');

      if (!hasVideo && !hasAudio) {
        throw new Error('No media devices found');
      }

      // Optimize video constraints for performance
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: hasVideo ? {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 24, max: 30 }
        } : false,
        audio: hasAudio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } : false
      });

      return this.localStream;
    } catch (err) {
      console.error('Failed to initialize media devices:', err);
      throw err;
    }
  }

  async getConnectionStats(peerId: string): Promise<string> {
    const conn = this.connections.get(peerId);
    if (!conn) return 'No connection found';

    const stats = conn.stats ?? { localCandidates: [], remoteCandidates: [] };
    const pc = conn.pc;

    let report = `
ICE Connection State: ${pc.iceConnectionState}
ICE Gathering State: ${pc.iceGatheringState}
Connection State: ${pc.connectionState}
Signaling State: ${pc.signalingState}

Selected Candidate Pair:
${stats.selectedCandidate ? 
  `  Local: ${stats.selectedCandidate.candidate}
   Remote: Found` : 
  '  No selected candidate pair yet'}

Local Candidates:
${stats.localCandidates.map(c => `  ${c.candidate} (${c.type})`).join('\n')}

Remote Candidates:
${stats.remoteCandidates.map(c => `  ${c.candidate} (${c.type})`).join('\n')}
`;

    try {
      const rtcStats = await pc.getStats();
      let selectedPair;
      rtcStats.forEach(stat => {
        if (stat.type === 'candidate-pair' && stat.selected) {
          selectedPair = stat;
          report += `\nSelected Pair Stats:
  Round Trip Time: ${stat.currentRoundTripTime}s
  Available Outgoing Bitrate: ${stat.availableOutgoingBitrate ?? 'N/A'}
  Bytes Sent: ${stat.bytesSent ?? 0}
  Bytes Received: ${stat.bytesReceived ?? 0}
  `;
        }
      });
    } catch (err) {
      console.error('Failed to get RTCStats:', err);
    }

    return report;
  }

  async createPeerConnection(peerId: string) {
    try {
      const pc = new RTCPeerConnection({
        ...this.rtcConfiguration,
        // Optimize ICE gathering
        iceCandidatePoolSize: 5
      });

      const stats: PeerConnection['stats'] = {
        localCandidates: [],
        remoteCandidates: []
      };

      this.connections.set(peerId, { 
        pc, 
        dataChannel: pc.createDataChannel('messageChannel', {
          ordered: true,
          maxRetransmits: 3
        }),
        stats,
        pendingCandidates: []
      });

      // Optimize event handlers
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          console.warn('ICE connection failed, attempting restart...');
          this.restartIce(peerId);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' && this.onPeerConnect) {
          this.onPeerConnect(peerId);
        } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState) && this.onPeerDisconnect) {
          this.onPeerDisconnect(peerId);
          if (pc.connectionState === 'failed') {
            this.restartConnection(peerId);
          }
        }
      };

      if (this.localStream) {
        // Add tracks with performance constraints
        this.localStream.getTracks().forEach(track => {
          if (this.localStream) {
            const sender = pc.addTrack(track, this.localStream);
            if (track.kind === 'video') {
              const params = sender.getParameters();
              // Set encoding parameters for better performance
              params.encodings = [{
                maxBitrate: 1000000, // 1 Mbps
                maxFramerate: 30,
                scaleResolutionDownBy: 1.0 // Scale down resolution if needed
              }];
              sender.setParameters(params).catch(console.error);
            }
          }
        });
      }

      pc.onicecandidate = event => {
        if (event.candidate) {
          if (this.onSignalingMessage) {
            this.onSignalingMessage(peerId, {
              type: 'candidate',
              data: event.candidate
            });
          }
        }
      };

      pc.ontrack = event => {
        const conn = this.connections.get(peerId);
        if (conn) {
          conn.stream = event.streams[0];
          if (this.onTrack) {
            this.onTrack(event.streams[0]);
          }
        }
      };

      return pc;
    } catch (err) {
      console.error('Failed to create peer connection:', err);
      throw err;
    }
  }

  private async restartIce(peerId: string) {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    try {
      await conn.pc.restartIce();
      const offer = await conn.pc.createOffer({ iceRestart: true });
      await conn.pc.setLocalDescription(offer);
      if (this.onSignalingMessage) {
        this.onSignalingMessage(peerId, {
          type: 'offer',
          data: offer
        });
      }
    } catch (err) {
      console.error('Failed to restart ICE:', err);
      this.restartConnection(peerId);
    }
  }

  private async restartConnection(peerId: string) {
    console.log('Restarting connection for peer:', peerId);
    this.closeConnection(peerId);
    
    try {
      const pc = await this.createPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.onSignalingMessage) {
        this.onSignalingMessage(peerId, {
          type: 'offer',
          data: offer
        });
      }
    } catch (err) {
      console.error('Failed to restart connection:', err);
    }
  }

  async createOffer(peerId: string) {
    try {
      const pc = await this.createPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      return offer;
    } catch (err) {
      console.error('Failed to create offer:', err);
      throw err;
    }
  }

  async handleOffer(peerId: string, offer: RTCSessionDescriptionInit) {
    try {
      const pc = await this.createPeerConnection(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Add any candidates that arrived before the remote description
      const conn = this.connections.get(peerId);
      if (conn && conn.pendingCandidates.length > 0) {
        console.log('Adding pending candidates after remote description set');
        await Promise.all(
          conn.pendingCandidates.map(candidate => 
            pc.addIceCandidate(candidate)
            .catch(err => console.warn('Failed to add pending candidate:', err))
          )
        );
        conn.pendingCandidates = [];
      }
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return answer;
    } catch (err) {
      console.error('Failed to handle offer:', err);
      throw err;
    }
  }

  async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit) {
    try {
      const conn = this.connections.get(peerId);
      if (!conn) {
        console.warn('No connection found for peer in handleAnswer:', peerId);
        return;
      }

      const pc = conn.pc;
      console.log('Current signaling state before setting remote answer:', pc.signalingState);
      
      // Check if we're in a valid state to set remote answer
      if (pc.signalingState === "stable") {
        console.warn('Connection already stable, ignoring redundant answer');
        return;
      }
      
      if (pc.signalingState !== "have-local-offer") {
        console.warn('Cannot set remote answer in current state:', pc.signalingState);
        // If we're not in the right state, we might need to create a new offer
        if (["stable", "closed"].includes(pc.signalingState)) {
          console.log('Creating new offer due to invalid state');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (this.onSignalingMessage) {
            this.onSignalingMessage(peerId, {
              type: 'offer',
              data: offer
            });
          }
        }
        return;
      }

      // Set the remote description
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('Successfully set remote answer, new state:', pc.signalingState);
      
      // Add any pending candidates after remote description is set
      if (conn.pendingCandidates.length > 0) {
        console.log('Adding', conn.pendingCandidates.length, 'pending candidates after remote description set');
        await Promise.all(
          conn.pendingCandidates.map(candidate => 
            pc.addIceCandidate(candidate)
            .catch(err => console.warn('Failed to add pending candidate:', err))
          )
        );
        conn.pendingCandidates = [];
      }
    } catch (err) {
      console.error('Failed to handle answer:', err);
      // If we get an error setting the remote description, try to recover
      this.restartConnection(peerId);
    }
  }

  async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    try {
      const conn = this.connections.get(peerId);
      if (!conn) {
        console.warn('No connection found for peer in handleIceCandidate:', peerId);
        return;
      }

      // Skip null candidates
      if (!candidate || !candidate.candidate) {
        console.log('Skipping null candidate');
        return;
      }

      try {
        // Create and validate ICE candidate before adding
        const iceCandidate = new RTCIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid || null,
          sdpMLineIndex: candidate.sdpMLineIndex || 0,
          usernameFragment: candidate.usernameFragment || null
        });

        // Only store and add valid candidates
        if (iceCandidate.candidate) {
          // Store remote candidate if stats tracking is enabled
          if (conn.stats) {
            conn.stats.remoteCandidates.push(iceCandidate);
            if (this.onStatsUpdate) {
              this.onStatsUpdate(peerId, conn.stats);
            }
          }

          // Check if we can add the candidate now
          if (conn.pc.remoteDescription && 
              conn.pc.remoteDescription.type && 
              conn.pc.signalingState !== 'closed') {
            try {
              await conn.pc.addIceCandidate(iceCandidate);
              console.log('Added ICE candidate:', iceCandidate.type, iceCandidate.protocol);
            } catch (err) {
              // If we get an unknown ufrag error, store the candidate for later
              if (err instanceof DOMException && err.message.includes('Unknown ufrag')) {
                console.log('Storing ICE candidate due to unknown ufrag');
                conn.pendingCandidates.push(iceCandidate);
              } else {
                throw err;
              }
            }
          } else {
            // Remote description not set yet, store candidate for later
            console.log('Storing ICE candidate for later');
            conn.pendingCandidates.push(iceCandidate);
          }
        }
      } catch (err) {
        console.warn('Failed to process ICE candidate:', err);
      }
    } catch (err) {
      console.error('Failed to handle ICE candidate:', err);
    }
  }

  closeConnection(peerId: string) {
    const conn = this.connections.get(peerId);
    if (conn) {
      if (conn.stream) {
        conn.stream.getTracks().forEach(track => {
          track.stop();
        });
      }
      conn.pc.close();
      this.connections.delete(peerId);
      if (this.onPeerDisconnect) {
        this.onPeerDisconnect(peerId);
      }
    }
  }

  cleanup() {
    // Stop all tracks in the local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
      });
      this.localStream = undefined;
    }

    // Close all peer connections
    for (const peerId of this.connections.keys()) {
      this.closeConnection(peerId);
    }
  }
}