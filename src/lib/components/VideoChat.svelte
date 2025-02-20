<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { WebRTCService } from '$lib/webrtc';
  import type { Did } from '$lib/schemas/types';
  
  const { peerId, sendSignalingMessage } = $props<{
    peerId: Did;
    sendSignalingMessage: (targetPeerId: string, message: any) => void;
  }>();
  
  let localVideo = $state<HTMLVideoElement>();
  let remoteVideos = $state<HTMLVideoElement[]>([]);
  let webrtc: WebRTCService | undefined;
  let connectionState = $state<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  const dispatch = createEventDispatcher();

  async function initializeMediaDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideo = devices.some(device => device.kind === 'videoinput');
      const hasAudio = devices.some(device => device.kind === 'audioinput');

      if (!hasVideo && !hasAudio) {
        throw new Error('No media devices found');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: hasVideo ? { width: 1280, height: 720 } : false,
        audio: hasAudio
      });

      return stream;
    } catch (err) {
      console.error('Media device error:', err);
      throw err;
    }
  }

  onMount(async () => {
    try {
      webrtc = new WebRTCService();
      
      // Set up event handlers
      webrtc.onPeerConnect = (peerId) => {
        connectionState = 'connected';
        dispatch('peerConnect', { did: peerId });
      };

      webrtc.onPeerDisconnect = (peerId) => {
        connectionState = 'disconnected';
        dispatch('peerDisconnect', { did: peerId });
      };

      webrtc.onSignalingMessage = (targetPeerId, message) => {
        // Send signal directly to peer
        sendSignalingMessage(targetPeerId, message);
      };

      webrtc.onTrack = (stream) => {
        if (stream.getVideoTracks().length > 0) {
          const video = document.createElement('video');
          video.srcObject = stream;
          video.autoplay = true;
          video.playsInline = true;
          remoteVideos = [...remoteVideos, video];
        }
      };

      // Initialize local stream
      const stream = await webrtc.initLocalStream();
      if (stream && localVideo) {
        localVideo.srcObject = stream;
        connectionState = 'connecting';
        
        // Create initial offer
        const offer = await webrtc.createOffer(peerId);
        sendSignalingMessage(peerId, { type: 'offer', data: offer });
      }
    } catch (err) {
      console.error('Failed to initialize video chat:', err);
      connectionState = 'disconnected';
    }
  });

  onDestroy(() => {
    if (webrtc) {
      webrtc.cleanup();
      webrtc = undefined;
    }
    stopLocalStream();
  });

  function toggleAudio() {
    if (localVideo?.srcObject) {
      const stream = localVideo.srcObject as MediaStream;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
      }
    }
  }

  function toggleVideo() {
    if (localVideo?.srcObject) {
      const stream = localVideo.srcObject as MediaStream;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
      }
    }
  }

  export function stopLocalStream() {
    if (localVideo?.srcObject) {
      const stream = localVideo.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      localVideo.srcObject = null;
    }
    
    // Stop and clear all remote video streams
    remoteVideos.forEach(video => {
      if (video.srcObject) {
        const stream = video.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
      }
    });
    remoteVideos = [];
  }

  export function handleSignalingMessage(peerId: string, message: any) {
    if (!webrtc) return;

    try {
      switch (message.type) {
        case 'offer':
          webrtc.handleOffer(peerId, message.data).then(answer => {
            sendSignalingMessage(peerId, { type: 'answer', data: answer });
          });
          break;
        case 'answer':
          webrtc.handleAnswer(peerId, message.data);
          break;
        case 'candidate':
          webrtc.handleIceCandidate(peerId, message.data);
          break;
      }
    } catch (err) {
      console.error('Failed to handle signaling message:', err);
      connectionState = 'disconnected';
    }
  }
</script>

{#if connectionState === 'disconnected'}
  <div class="permission-prompt">
    <p>Please allow camera/mic access</p>
    <button onclick={async () => {
      try {
        const stream = await initializeMediaDevices();
        if (localVideo) {
          localVideo.srcObject = stream;
          if (webrtc) await webrtc.initLocalStream(stream);
        }
      } catch (err) {
        console.error('Failed to get media permissions:', err);
      }
    }}>
      Retry
    </button>
  </div>
{/if}

<div class="video-container">
  {#each remoteVideos as remoteVideo, i (i)}
    <video
      bind:this={remoteVideos[i]}
      autoplay
      playsinline
      class="remote-video"
    >
      <track kind="captions" label="English" />
    </video>
  {/each}

  <video
    bind:this={localVideo}
    autoplay
    playsinline
    muted
    class="local-video"
  >
    <track kind="captions" label="English" />
  </video>

  <div class="controls">
    <button onclick={toggleAudio} class={!localVideo?.srcObject ? 'disabled' : ''}>
      🎤
    </button>
    <button onclick={toggleVideo} class={!localVideo?.srcObject ? 'disabled' : ''}>
      📹
    </button>
  </div>
</div>

<style>
  .video-container {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .remote-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .local-video {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    width: 120px;
    height: 90px;
    border-radius: 0.5rem;
    object-fit: cover;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .controls {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 1rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    border-radius: 2rem;
  }

  button {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.2);
    color: white;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  button:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: scale(1.1);
  }

  button.disabled {
    background: rgba(255, 0, 0, 0.2);
    opacity: 0.7;
    cursor: not-allowed;
  }

  .permission-prompt {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    padding: 1rem;
    border-radius: 0.5rem;
    color: white;
    text-align: center;
    z-index: 20;
  }
</style>