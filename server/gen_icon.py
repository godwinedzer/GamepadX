from PIL import Image
import os

img = Image.open(r"d:\gamepad\client\assets\images\icon.jpg")
icon_sizes = [(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)]
img.save(r"d:\gamepad\server\server.ico", sizes=icon_sizes)
print("Saved server.ico")
