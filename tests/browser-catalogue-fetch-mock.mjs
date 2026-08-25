const ggufModel = {
  id: "org/Llama-3.2-3B-GGUF",
  sha: "1111111111111111111111111111111111111111",
  downloads: 3000,
  lastModified: "2026-08-01T00:00:00Z",
  tags: ["instruct", "chat"],
  pipeline_tag: "text-generation",
  cardData: { params: "3B" },
  siblings: [{ rfilename: "llama-3.2-3b.Q4_K_M.gguf", size: 2_000_000_000 }],
};

const mlxModel = {
  id: "mlx-community/Llama-3.2-3B-4bit",
  sha: "2222222222222222222222222222222222222222",
  library_name: "mlx",
  downloads: 2000,
  lastModified: "2026-08-01T00:00:00Z",
  tags: ["instruct", "chat"],
  pipeline_tag: "text-generation",
  cardData: { params: "3B" },
  siblings: [{ rfilename: "weights.safetensors", size: 2_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }],
};

globalThis.fetch = async (input) => {
  const url = String(input);
  if (!url.startsWith("https://huggingface.co/api/models")) throw new Error(`Unexpected browser-test fetch: ${url}`);
  if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [mlxModel] : [ggufModel]);
  if (url.includes("?blobs=true")) return Response.json(url.includes("mlx-community") ? mlxModel : ggufModel);
  throw new Error(`Unexpected Hugging Face browser-test fetch: ${url}`);
};
