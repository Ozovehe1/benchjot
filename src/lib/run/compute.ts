// Server runs: CPU or GPU, decided from the code when the cell doesn't say (`# gpu:`). Pure.
//
// A GPU only speeds up deep learning (PyTorch, TensorFlow / Keras, JAX, Transformers, ...), and for
// small jobs it is slower: the machine takes longer to start and data has to move to the card.
// So a cell gets a GPU when it says so in code (`.cuda()`, `device="cuda"`, `device_map=`, XGBoost
// on the GPU, CuPy / RAPIDS), or when it uses a deep learning library AND does heavy work (at least
// HEAVY_SCORE points of the signals below). The bigger cards are for big models only. Every
// decision comes with its reasons, which the run shows.
import type { Gpu } from "./server-languages";

interface ComputeChoice {
  gpu: Gpu | null;
  /** Short, plain reasons, shown to the user ("convolutional layers", "image dataset (CIFAR-10)"). */
  reasons: string[];
}

/** Points of heavy work a deep learning cell needs before it goes to a GPU. */
const HEAVY_SCORE = 2;

const DEEP_LEARNING = /^\s*(?:import|from)\s+(torch|torchvision|torchaudio|torchtext|tensorflow|tensorflow_hub|tf_keras|keras|keras_cv|keras_nlp|jax|flax|optax|transformers|diffusers|ultralytics|timm|lightning|pytorch_lightning|sentence_transformers|accelerate|peft|fastai|detectron2|segment_anything)\b/m;

/** The code asks for the GPU itself: always a GPU. */
const USES_GPU: [RegExp, string][] = [
  [/\.cuda\(\s*\)|torch\.cuda\.|\bdevice\s*=\s*["']cuda|torch\.device\(\s*["']cuda|\.to\(\s*["']cuda/, "uses CUDA"],
  [/device_map\s*=/, "loads a model across the GPU (device_map)"],
  [/list_physical_devices\(\s*["']GPU|set_memory_growth|tf\.device\(\s*["']\/?GPU/i, "uses TensorFlow's GPU"],
  [/tree_method\s*=\s*["']gpu_hist|\bdevice\s*=\s*["']gpu["']|task_type\s*=\s*["']GPU/, "trains gradient boosting on the GPU"],
  [/^\s*(?:import|from)\s+(cupy|cudf|cuml|cugraph)\b/m, "uses RAPIDS / CuPy"],
];

/**
 * Heavy work, with its points; a deep learning cell needs HEAVY_SCORE in all. Training (the last two)
 * counts once at most: it's needed for a GPU to matter, but a long training of a tiny model is still
 * a small job, so training alone never reaches a GPU.
 */
const TRAINING = new Set(["trains a model", "trains for many epochs"]);
const HEAVY: [RegExp, number, string][] = [
  [/\bConv[123]d\b|\bConv[123]D\b|layers\.Conv|nn\.Conv/, 1, "convolutional layers"],
  [/\b(LSTM|GRU|MultiheadAttention|TransformerEncoder|TransformerDecoder|nn\.Transformer)\b|layers\.(LSTM|GRU|MultiHeadAttention)/, 1, "recurrent / attention layers"],
  [/from_pretrained\(|\bpipeline\(|\b(resnet\d*|vgg\d*|efficientnet\w*|mobilenet\w*|densenet\d*|inception\w*|vit_\w+|ResNet\d+|VGG\d+|EfficientNet\w*|MobileNet\w*|DenseNet\d+|InceptionV3|Xception)\b|\bYOLO\(|StableDiffusion|timm\.create_model/, 2, "a pretrained model"],
  [/\b(cifar10|cifar100|CIFAR10|CIFAR100|imagenet|ImageNet|ImageFolder|fashion_mnist|FashionMNIST|mnist|MNIST|coco|COCO|celeba|CelebA|image_dataset_from_directory)\b/, 1, "an image dataset"],
  [/\.backward\(\)|\.fit\(|train_step|Trainer\(/, 1, "trains a model"],
  [/\bepochs\s*=\s*([1-9]\d+)|for\s+\w+\s+in\s+range\(\s*([1-9]\d+)\s*\)\s*:\s*(?:#.*)?\n(?:[^\n]*\n){0,6}?[^\n]*(?:\.backward\(\)|\.step\(\)|train)/, 1, "trains for many epochs"],
];

/** Big models: a bigger card (the model must fit in its memory). */
const BIG_MODELS: [RegExp, Gpu, string][] = [
  [/\b(70b|65b|40b|34b)\b/i, "A100", "a very large model"],
  [/\b(7b|8b|13b|llama|mistral|mixtral|qwen|gemma|falcon|stable-diffusion|stable_diffusion|sdxl|StableDiffusionXL|flux)\b/i, "A10G", "a large model"],
];

/** The code without comments (a note saying "no cuda here" isn't a signal; directives are read elsewhere). */
function withoutComments(code: string): string {
  return code
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
}

/** CPU or which GPU for a Python cell, and why. Other languages: CPU. */
export function chooseCompute(language: string, rawCode: string): ComputeChoice {
  if (language !== "python") return { gpu: null, reasons: [] };
  const code = withoutComments(rawCode);
  const explicit = USES_GPU.filter(([re]) => re.test(code)).map(([, why]) => why);
  const deepLearning = DEEP_LEARNING.test(code);
  let score = 0;
  const heavy: string[] = [];
  if (deepLearning) {
    let trained = false;
    for (const [re, points, why] of HEAVY) {
      if (!re.test(code)) continue;
      heavy.push(why);
      if (TRAINING.has(why)) {
        if (!trained) score += points;
        trained = true;
      } else {
        score += points;
      }
    }
  }
  if (!explicit.length && score < HEAVY_SCORE) {
    const why = deepLearning ? ["deep learning, but a small job (faster on the CPU)"] : ["no deep learning (a GPU wouldn't speed it up)"];
    return { gpu: null, reasons: why };
  }
  const big = deepLearning ? BIG_MODELS.find(([re]) => re.test(code)) : undefined;
  return { gpu: big ? big[1] : "T4", reasons: [...explicit, ...heavy, ...(big ? [big[2]] : [])] };
}

/** The line a run shows about where it ran when the choice was automatic. */
export function computeNote(choice: ComputeChoice): string {
  const why = choice.reasons.join(", ");
  return choice.gpu ? `[Benchjot] Ran on a ${choice.gpu} GPU (chosen automatically: ${why}). Add # gpu: none to use the CPU.\n` : "";
}
