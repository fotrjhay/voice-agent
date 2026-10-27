export function releaseResources(resources: { abort: AbortController; stream?: MediaStream; peer?: RTCPeerConnection; channel?: RTCDataChannel; audio?: HTMLAudioElement; timer?: ReturnType<typeof setTimeout> }) {
  resources.abort.abort();
  clearTimeout(resources.timer);
  resources.stream?.getTracks().forEach(track => track.stop());
  resources.channel?.close();
  resources.peer?.close();
  if (resources.audio) { resources.audio.pause(); resources.audio.srcObject = null; }
}
