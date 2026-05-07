# Xenova/whisper-base.en — local model bundle
#
# These files are served by the web server so the browser loads the higher-quality
# Whisper speech-recognition model without downloading it from HuggingFace at runtime.
#
# Populated by: .github/workflows/download-whisper-model.yml
#
# Directory layout expected by @xenova/transformers (env.localModelPath):
#   config.json
#   generation_config.json
#   tokenizer.json
#   tokenizer_config.json
#   preprocessor_config.json
#   onnx/encoder_model_quantized.onnx
#   onnx/decoder_model_merged_quantized.onnx
#
# If the onnx/ files are absent, Transformers.js falls back to fetching the
# model from HuggingFace automatically (allowRemoteModels defaults to true).
