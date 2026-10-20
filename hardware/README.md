# Tactile seat panel (Member C, stretch)

ESP32 + four raised-icon buttons (water, blanket, toilet, help) + vibration motor + confirm LED.
Connects to the hub over Wi-Fi as a passenger socket: `ws://<hub>:8000/ws/passenger/<seat>` and sends
`{"type": "icon", "intent": "water"}`. Vibrate and light the LED when a `status` message arrives.
