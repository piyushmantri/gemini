const DEFAULT_MODELS = [
  { name: 'models/gemini-1.5-flash', methods: ['generateContent'] },
  { name: 'models/gemini-1.5-pro', methods: ['generateContent'] },
  { name: 'models/nonobanana-3', methods: ['generateContent'] },
  { name: 'models/imagen-4.0-generate-001', methods: ['generateImages'] },
  { name: 'models/imagen-4.0-ultra-generate-001', methods: ['generateImages'] },
  { name: 'models/imagen-4.0-fast-generate-001', methods: ['generateImages'] },
  { name: 'models/imagen-3.0-generate-002', methods: ['generateImages'] }
];

const state = {
  conversation: [],
  pendingRequest: null,
  errorTimeout: null,
  errorBanner: null,
  modelCapabilities: new Map(
    DEFAULT_MODELS.map((entry) => [entry.name, new Set(entry.methods)])
  ),
  pendingImage: null
};

const elements = {
  app: document.querySelector('.app'),
  apiKey: document.getElementById('apiKey'),
  modelInput: document.getElementById('modelInput'),
  chat: document.getElementById('chat'),
  promptForm: document.getElementById('promptForm'),
  promptInput: document.getElementById('promptInput'),
  imageInput: document.getElementById('imageInput'),
  imagePreview: document.getElementById('imagePreview'),
  previewImage: document.querySelector('#imagePreview img'),
  clearImage: document.getElementById('clearImage'),
  template: document.getElementById('messageTemplate'),
  sendButton: document.querySelector('#promptForm button'),
  config: document.querySelector('.config')
};

initModelInput();
showEmptyState();
registerEventHandlers();

function registerEventHandlers() {
  elements.promptForm.addEventListener('submit', handleSubmit);
  if (elements.imageInput) {
    elements.imageInput.addEventListener('change', handleImageChange);
  }
  if (elements.clearImage) {
    elements.clearImage.addEventListener('click', handleClearImageClick);
  }
}

function initModelInput() {
  const defaultModel = DEFAULT_MODELS[0]?.name || '';
  if (defaultModel) {
    elements.modelInput.value = defaultModel;
  }
}

async function handleImageChange(event) {
  const file = event?.target?.files?.[0];
  if (!file) {
    clearImageSelection();
    return;
  }

  if (!file.type || !file.type.startsWith('image/')) {
    showError('Please choose an image file.');
    clearImageSelection({ focus: true });
    return;
  }

  try {
    const dataUrl = await readFileAsDataURL(file);
    const base64 = stripDataPrefix(dataUrl);
    if (!base64) {
      throw new Error('Failed to process the selected image.');
    }
    state.pendingImage = {
      name: file.name,
      mimeType: file.type || 'image/png',
      base64,
      previewUrl: dataUrl
    };
    showImagePreview(dataUrl);
  } catch (error) {
    showError(normalizeError(error));
    clearImageSelection({ focus: true });
  }
}

function handleClearImageClick(event) {
  event.preventDefault();
  clearImageSelection({ focus: true });
}

function showImagePreview(dataUrl) {
  if (!elements.imagePreview || !elements.previewImage) {
    return;
  }
  elements.previewImage.src = dataUrl;
  elements.imagePreview.hidden = false;
  if (elements.clearImage) {
    elements.clearImage.disabled = false;
  }
}

function clearImageSelection({ focus = false } = {}) {
  state.pendingImage = null;
  if (elements.imageInput) {
    elements.imageInput.value = '';
    if (focus) {
      elements.imageInput.focus();
    }
  }
  if (elements.previewImage) {
    elements.previewImage.removeAttribute('src');
  }
  if (elements.imagePreview) {
    elements.imagePreview.hidden = true;
  }
  if (elements.clearImage) {
    elements.clearImage.disabled = true;
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function getModelCapabilities(model) {
  const normalized = normalizeModelName(model);
  if (!normalized) {
    return new Set();
  }
  const existing = state.modelCapabilities.get(normalized);
  if (existing instanceof Set) {
    return existing;
  }
  if (Array.isArray(existing)) {
    const reconstructed = new Set(existing);
    state.modelCapabilities.set(normalized, reconstructed);
    return reconstructed;
  }
  if (normalized.includes('imagen')) {
    const heuristics = new Set(['generateImages']);
    state.modelCapabilities.set(normalized, heuristics);
    return heuristics;
  }
  const fallback = new Set(['generateContent']);
  state.modelCapabilities.set(normalized, fallback);
  return fallback;
}

async function handleSubmit(event) {
  event.preventDefault();

  clearError();

  if (state.pendingRequest) {
    showError('Please wait for the current response to finish.');
    return;
  }

  const apiKey = elements.apiKey.value.trim();
  let model = elements.modelInput.value.trim();
  const prompt = elements.promptInput.value.trim();

  if (!apiKey) {
    showError('Gemini API key is required.');
    elements.apiKey.focus();
    return;
  }

  if (!model) {
    showError('Select a Gemini model to continue.');
    elements.modelInput.focus();
    return;
  }

  if (!prompt && !state.pendingImage) {
    return;
  }

  model = normalizeModelName(model);
  elements.modelInput.value = model;
  clearEmptyState();

  const capabilities = getModelCapabilities(model);
  const canGenerateContent = capabilities.has('generateContent');
  const canGenerateImages = capabilities.has('generateImages');

  if (state.pendingImage && !canGenerateContent) {
    showError('This model does not accept image uploads. Try a Gemini multimodal model.');
    return;
  }

  const imageSelection = state.pendingImage
    ? { inlineData: { mimeType: state.pendingImage.mimeType, data: state.pendingImage.base64 } }
    : null;

  if (imageSelection) {
    clearImageSelection();
  }

  const userParts = [];
  if (prompt) {
    userParts.push({ text: prompt });
  }
  if (imageSelection) {
    userParts.push(imageSelection);
  }
  if (!userParts.length) {
    return;
  }

  const userMessageElement = addMessage('user', userParts);
  scrollChatToBottom();

  elements.promptInput.value = '';
  setFormDisabled(true);

  const pendingElement = addMessage('model', null, { pending: true });
  scrollChatToBottom();

  let userEntry = null;
  let requestKind = 'none';

  try {
    if (canGenerateContent) {
      requestKind = 'content';
      userEntry = { role: 'user', parts: cloneParts(userParts) };
      state.conversation.push(userEntry);
      state.pendingRequest = sendToGeminiContent({ apiKey, model, contents: state.conversation });
      const response = await state.pendingRequest;

      if (response?.promptFeedback?.blockReason) {
        throw new Error(`Blocked by safety filters: ${response.promptFeedback.blockReason}`);
      }

      const candidate = response?.candidates?.find((c) => c?.content?.parts?.length);
      if (!candidate) {
        throw new Error('Gemini returned no usable content.');
      }

      if (candidate.finishReason === 'SAFETY') {
        throw new Error('Response halted by Gemini safety filters.');
      }

      const parts = candidate.content.parts;
      updateMessageElement(pendingElement, parts);
      state.conversation.push({ role: 'model', parts: cloneParts(parts) });
    } else if (canGenerateImages) {
      requestKind = 'images';
      state.pendingRequest = sendToGeminiImages({ apiKey, model, prompt });
      const response = await state.pendingRequest;

      if (response?.promptFeedback?.blockReason) {
        throw new Error(`Blocked by safety filters: ${response.promptFeedback.blockReason}`);
      }

      const parts = toImageParts(response);
      if (!parts.length) {
        throw new Error('Gemini returned no images.');
      }
      updateMessageElement(pendingElement, parts);
    } else {
      throw new Error('Selected model does not appear to support text or image generation in this client. Try another model ID.');
    }
  } catch (error) {
    if (requestKind === 'content' && userEntry) {
      state.conversation.pop();
    }
    pendingElement.remove();
    showError(normalizeError(error));
    userMessageElement.classList.add('message--failed');
  } finally {
    state.pendingRequest = null;
    setFormDisabled(false);
    elements.promptInput.focus();
  }
}

async function sendToGeminiContent({ apiKey, model, contents }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = { contents };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Failed to parse Gemini response.');
  }

  if (!response.ok) {
    const message = data?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Gemini API error: ${message}`);
  }

  return data;
}

async function sendToGeminiImages({ apiKey, model, prompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateImages?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    prompt: { text: prompt }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Failed to parse Gemini response.');
  }

  if (!response.ok) {
    const message = data?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Gemini API error: ${message}`);
  }

  return data;
}

function toImageParts(response) {
  const parts = [];
  const images = collectGeneratedImages(response);
  images.forEach((image) => {
    const inline = extractInlineImage(image);
    if (inline) {
      parts.push({ inlineData: inline });
      return;
    }
    const link = extractImageLink(image);
    if (link) {
      parts.push({ fileData: link });
    }
  });

  const generatedTexts = collectGeneratedTexts(response);
  generatedTexts.forEach((text) => {
    if (text) {
      parts.push({ text });
    }
  });

  return parts;
}

function collectGeneratedImages(response) {
  if (!response) {
    return [];
  }
  if (Array.isArray(response.generatedImages)) {
    return response.generatedImages;
  }
  if (Array.isArray(response.images)) {
    return response.images;
  }
  if (Array.isArray(response.results)) {
    return response.results;
  }
  return [];
}

function extractInlineImage(image) {
  if (!image) {
    return null;
  }
  const base64 = image.b64Image || image.image || image.data || image.base64Data;
  if (!base64) {
    const inline = image.inlineData?.data;
    if (!inline) {
      return null;
    }
    return {
      mimeType: image.inlineData.mimeType || image.mimeType || 'image/png',
      data: stripDataPrefix(inline)
    };
  }
  return {
    mimeType: image.mimeType || 'image/png',
    data: stripDataPrefix(base64)
  };
}

function extractImageLink(image) {
  if (!image) {
    return null;
  }
  const uri = image.imageUri || image.uri || image.contentUri;
  if (!uri) {
    return null;
  }
  return {
    fileUri: uri,
    mimeType: image.mimeType || undefined
  };
}

function collectGeneratedTexts(response) {
  const texts = [];
  if (!response) {
    return texts;
  }
  if (Array.isArray(response.generatedTexts)) {
    response.generatedTexts.forEach((entry) => {
      if (entry?.text) {
        texts.push(entry.text);
      } else if (typeof entry === 'string') {
        texts.push(entry);
      }
    });
  }
  if (Array.isArray(response.texts)) {
    response.texts.forEach((text) => {
      if (typeof text === 'string') {
        texts.push(text);
      }
    });
  }
  if (typeof response.text === 'string') {
    texts.push(response.text);
  }
  return texts;
}

function stripDataPrefix(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const prefixIndex = value.indexOf('base64,');
  if (prefixIndex === -1) {
    return value.trim();
  }
  return value.slice(prefixIndex + 'base64,'.length).trim();
}

function addMessage(role, parts, { pending = false } = {}) {
  const fragment = elements.template.content.cloneNode(true);
  const messageElement = fragment.querySelector('.message');
  const roleElement = fragment.querySelector('.message__role');
  const timeElement = fragment.querySelector('.message__time');
  const contentElement = fragment.querySelector('.message__content');

  messageElement.classList.add(role === 'user' ? 'message--user' : 'message--model');
  roleElement.textContent = role === 'user' ? 'You' : 'Gemini';
  timeElement.textContent = formatTime(new Date());

  if (pending) {
    contentElement.appendChild(createLoadingIndicator());
  } else if (Array.isArray(parts) && parts.length) {
    renderParts(parts, contentElement);
  }

  elements.chat.appendChild(messageElement);
  return messageElement;
}

function updateMessageElement(element, parts) {
  const timeElement = element.querySelector('.message__time');
  const contentElement = element.querySelector('.message__content');

  timeElement.textContent = formatTime(new Date());
  contentElement.innerHTML = '';
  renderParts(parts, contentElement);
}

function renderParts(parts, container) {
  parts.forEach((part) => {
    if (!part) return;

    if (typeof part.text === 'string') {
      renderTextPart(container, part.text);
      return;
    }

    if (part.inlineData) {
      renderInlineData(container, part.inlineData);
      return;
    }

    if (part.fileData) {
      renderFileData(container, part.fileData);
      return;
    }

    if (part.functionCall) {
      renderFunctionCall(container, part.functionCall);
      return;
    }

    if (part.functionResponse) {
      renderFunctionResponse(container, part.functionResponse);
      return;
    }

    const fallback = document.createElement('pre');
    fallback.textContent = JSON.stringify(part, null, 2);
    container.appendChild(fallback);
  });
}

function renderTextPart(container, text) {
  if (!text.trim()) {
    return;
  }

  if (!text.includes('```')) {
    appendParagraphs(container, text);
    return;
  }

  const segments = text.split('```');
  segments.forEach((segment, index) => {
    if (index % 2 === 0) {
      appendParagraphs(container, segment);
    } else {
      const { language, code } = splitCodeSegment(segment);
      const pre = document.createElement('pre');
      pre.textContent = code;
      if (language) {
        pre.setAttribute('data-lang', language);
      }
      container.appendChild(pre);
    }
  });
}

function appendParagraphs(container, text) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return;
  }

  paragraphs.forEach((paragraph) => {
    const p = document.createElement('p');
    p.textContent = paragraph.replace(/\n/g, ' ');
    container.appendChild(p);
  });
}

function splitCodeSegment(segment) {
  const trimmed = segment.replace(/\n+$/, '');
  const newlineIndex = trimmed.indexOf('\n');

  if (newlineIndex === -1) {
    return { language: '', code: trimmed.trim() };
  }

  const language = trimmed.slice(0, newlineIndex).trim();
  const code = trimmed.slice(newlineIndex + 1).trim();
  return { language, code };
}

function renderInlineData(container, inlineData) {
  const { mimeType, data } = inlineData;
  if (!data) {
    return;
  }

  const src = `data:${mimeType};base64,${data}`;

  if (mimeType?.startsWith('image/')) {
    const img = new Image();
    img.src = src;
    img.alt = 'Gemini generated image';
    container.appendChild(img);
    return;
  }

  if (mimeType?.startsWith('video/')) {
    const video = document.createElement('video');
    video.controls = true;
    video.src = src;
    container.appendChild(video);
    return;
  }

  const link = document.createElement('a');
  link.href = src;
  link.textContent = `Download ${mimeType || 'attachment'}`;
  link.className = 'media-link';
  link.download = `gemini-${mimeType?.split('/')?.[0] || 'file'}`;
  container.appendChild(link);
}

function renderFileData(container, fileData) {
  const { fileUri, mimeType } = fileData;
  if (!fileUri) {
    return;
  }

  const link = document.createElement('a');
  link.href = fileUri;
  link.textContent = `Open ${mimeType || 'file'}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'media-link';
  container.appendChild(link);
}

function renderFunctionCall(container, functionCall) {
  const pre = document.createElement('pre');
  pre.textContent = `Function call:\n${JSON.stringify(functionCall, null, 2)}`;
  container.appendChild(pre);
}

function renderFunctionResponse(container, functionResponse) {
  const pre = document.createElement('pre');
  pre.textContent = `Function response:\n${JSON.stringify(functionResponse, null, 2)}`;
  container.appendChild(pre);
}

function createLoadingIndicator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'loading-indicator';
  wrapper.setAttribute('aria-label', 'Loading');

  wrapper.appendChild(document.createTextNode('Thinking'));
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement('span');
    wrapper.appendChild(dot);
  }

  return wrapper;
}

function setFormDisabled(isDisabled) {
  elements.promptInput.disabled = isDisabled;
  elements.sendButton.disabled = isDisabled;
  if (elements.imageInput) {
    elements.imageInput.disabled = isDisabled;
  }
  if (elements.clearImage) {
    elements.clearImage.disabled = isDisabled;
  }
}

function normalizeModelName(model) {
  if (!model) {
    return '';
  }
  const trimmed = String(model).trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes('/')) {
    return trimmed;
  }
  return `models/${trimmed}`;
}

function cloneParts(parts) {
  try {
    return structuredClone(parts);
  } catch (error) {
    return JSON.parse(JSON.stringify(parts));
  }
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    elements.chat.scrollTop = elements.chat.scrollHeight;
  });
}

function showEmptyState() {
  elements.chat.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = 'Enter your Gemini API key, pick a model, and start chatting.';
  elements.chat.appendChild(div);
}

function clearEmptyState() {
  const placeholder = elements.chat.querySelector('.empty-state');
  if (placeholder) {
    placeholder.remove();
  }
}

function showError(message) {
  clearError();
  const banner = document.createElement('div');
  banner.className = 'error-banner';
  banner.setAttribute('role', 'alert');
  banner.textContent = message;
  elements.config.insertAdjacentElement('afterend', banner);
  state.errorBanner = banner;
  state.errorTimeout = window.setTimeout(() => {
    clearError();
  }, 7000);
}

function clearError() {
  if (state.errorTimeout) {
    clearTimeout(state.errorTimeout);
    state.errorTimeout = null;
  }
  if (state.errorBanner) {
    state.errorBanner.remove();
    state.errorBanner = null;
  }
}

function normalizeError(error) {
  if (!error) {
    return 'Unknown error.';
  }
  if (typeof error === 'string') {
    return enrichErrorMessage(error);
  }
  if (error instanceof Error) {
    return enrichErrorMessage(error.message);
  }
  if (typeof error === 'object' && error.message) {
    return enrichErrorMessage(error.message);
  }
  try {
    return enrichErrorMessage(JSON.stringify(error));
  } catch (serializationError) {
    return 'Unexpected error occurred.';
  }
}

function enrichErrorMessage(message) {
  if (!message) {
    return 'Unknown error.';
  }
  if (message.includes('not found for API version') && (message.includes('generateContent') || message.includes('generateImages'))) {
    return `${message} Double-check the model ID or try another supported model.`;
  }
  return message;
}
