<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { WebRTCService } from '$lib/webrtc';
  import type { Did } from '$lib/schemas/types';
  
  export let peerId: Did;
  export let sendSignalingMessage: (targetPeerId: string, message: any) => void;
  
  let localVideo: HTMLVideoElement;
  let remoteVideo: HTMLVideoElement;
  let webrtc: WebRTCService;
  
  const dispatch = createEventDispatcher();

  onMount(async () => {
    webrtc = new WebRTCService();
    
    // Initialize local stream
    const stream = await webrtc.initLocalStream();
    if (localVideo) {
      localVideo.srcObject = stream;
    }

    // Handle connection state changes
    webrtc.onPeerConnect = (peerId) => {
      dispatch('peerConnect', { did: peerId });
    };

    webrtc.onPeerDisconnect = (peerId) => {
      dispatch('peerDisconnect', { did: peerId });
    };

    webrtc.onSignalingMessage = (targetPeerId, message) => {
      sendSignalingMessage(targetPeerId, message);
    };

    // Start connection process
    const offer = await webrtc.createOffer(peerId);
    sendSignalingMessage(peerId, { type: 'offer', data: offer });
  });

  onDestroy(() => {
    stopLocalStream();
    webrtc?.closeConnection(peerId);
  });

  export function stopLocalStream() {
    if (localVideo?.srcObject) {
      const stream = localVideo.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      localVideo.srcObject = null;
    }
    if (remoteVideo?.srcObject) {
      const stream = remoteVideo.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      remoteVideo.srcObject = null;
    }
  }

  export function handleSignalingMessage(sourcePeerId: string, message: any) {
    if (message.type === 'offer') {
      webrtc.handleOffer(sourcePeerId, message.data).then(answer => {
        sendSignalingMessage(sourcePeerId, { type: 'answer', data: answer });
      });
    } else if (message.type === 'answer') {
      webrtc.handleAnswer(sourcePeerId, message.data);
    } else if (message.type === 'candidate') {
      webrtc.handleIceCandidate(sourcePeerId, message.data);
    }
  }
</script>

<div class="video-chat">
  <div class="video-container">
    <video
      bind:this={localVideo}
      autoplay
      playsinline
      muted
      class="local-video"
    />
    <video
      bind:this={remoteVideo}
      autoplay
      playsinline
      class="remote-video"
    />
  </div>
  
  <div class="controls">
    <button>Mute</button>
    <button>Stop Video</button>
    <button>End Call</button>
  </div>
</div>

<style>
  .video-chat {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .video-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1rem;
  }

  video {
    width: 100%;
    border-radius: 0.5rem;
    background: #000;
  }

  .controls {
    display: flex;
    gap: 1rem;
    justify-content: center;
  }
</style>