class ProxyWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    console.log("ProxyWebSocket: constructor called, readyState:", this.readyState);

    this.addEventListener("open", () => {
      console.log("ProxyWebSocket: connection opened, readyState:", this.readyState);
    });

    const originalOnMessage = this.onmessage;
    this.onmessage = null; // Remove the onmessage property assignment

    // this.addEventListener('message', (event: MessageEvent) => {
    //   const decoder = new TextDecoder('utf-8');
    //   // const decodedString = decoder.decode(event.data);
    //   // console.log("ProxyWebSocket: onmessage handler called",decodedString);
    //   if (originalOnMessage) {
    //     originalOnMessage.bind(this)(event);
    //   }
    // });

    this.addEventListener("error", (event) => {
      console.error("ProxyWebSocket: error:", event);
    });

    this.addEventListener("close", (event) => {
      console.log("ProxyWebSocket: connection closed:", event);
    });
  }
}

export default ProxyWebSocket;