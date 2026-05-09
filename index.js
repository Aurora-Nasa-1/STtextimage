import { eventSource, event_types } from '../../../../script.js';

// 核心状态管理 (完全遵循官方扩展开发指南)
const MODULE_NAME = 'STtextimage';

// 默认设置
const defaultSettings = Object.freeze({
    apiUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    apiKey: '',
    modelId: 'llava',
    prompt: 'Please describe this image in detail. Focus on the main subjects and the environment.',
    template: '\n[System Note: The user shared an image. Description: {{caption}}]\n'
});

// 获取并初始化设置
function getSettings() {
    // 使用 SillyTavern.getContext() 替代不稳定的直接 import
    const { extensionSettings } = SillyTavern.getContext();
    
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    
    // 确保所有默认键都存在
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return extensionSettings[MODULE_NAME];
}

// 绑定 UI 设置变化并持久化
function bindSettingsUI() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    const settings = getSettings();

    $('#cvi_api_url, #cvi_api_key, #cvi_model_id, #cvi_prompt, #cvi_template').on('input', function () {
        settings.apiUrl = $('#cvi_api_url').val();
        settings.apiKey = $('#cvi_api_key').val();
        settings.modelId = $('#cvi_model_id').val();
        settings.prompt = $('#cvi_prompt').val();
        settings.template = $('#cvi_template').val();
        
        // 持久化保存设置
        saveSettingsDebounced();
    });
}

// 图片转 Base64 并压缩大小，防止超出上下文 Token 限制
function resizeImageAsBase64(file, maxWidth = 1024, maxHeight = 1024) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                let width = img.width;
                let height = img.height;

                // 计算压缩比例
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = width * ratio;
                    height = height * ratio;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // 输出为 JPEG 以减小体积，质量设定为 0.85
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = error => reject(error);
            img.src = event.target.result;
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

// 调用自定义视觉 API (使用标准 OpenAI 多模态格式)
async function callCustomVisionAPI(base64Image) {
    const settings = getSettings();
    
    // 构造 OpenAI 格式的 Payload
    const payload = {
        model: settings.modelId,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: settings.prompt },
                    { type: "image_url", image_url: { url: base64Image } }
                ]
            }
        ],
        max_tokens: 500
    };

    const headers = {
        'Content-Type': 'application/json'
    };
    if (settings.apiKey) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
    }

    try {
        const response = await fetch(settings.apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API 请求失败: ${response.status} ${response.statusText} - 详情: ${errorText}`);
        }

        const data = await response.json();
        // 提取返回的文本
        return data.choices[0].message.content;
    } catch (error) {
        console.error("[Custom Vision] API Error:", error);
        toastr.error("视觉模型 API 调用失败，请检查 F12 控制台报错。");
        return null;
    }
}

// 核心处理函数
async function processSelectedImage(file) {
    toastr.info("正在将图片发送至自定义视觉模型处理...");
    
    try {
        // 1. 转为 Base64 (加入图片压缩，避免超出 Token 限制)
        const base64Image = await resizeImageAsBase64(file);
        
        // 2. 调用 API 获取描述
        const caption = await callCustomVisionAPI(base64Image);
        
        if (caption) {
            // 3. 格式化并注入到输入框
            const settings = getSettings();
            const injectedText = settings.template.replace('{{caption}}', caption.trim());
            
            const textarea = document.getElementById('send_textarea');
            textarea.value = textarea.value + injectedText;
            
            // 触发 input 事件，让 ST 的自动调整高度等 UI 逻辑生效
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            
            toastr.success("图片描述已成功注入输入框！");
        }
    } catch (err) {
        console.error(err);
        toastr.error("处理图片时发生错误。");
    }
}

// 添加 UI 按钮
function injectUI() {
    // 隐藏的 File Input
    const fileInputHtml = `<input type="file" id="cvi_file_input" accept="image/*" style="display: none;">`;
    $('body').append(fileInputHtml);

    // 在 ST 的聊天输入框旁边添加一个按钮
    const buttonHtml = `
        <div id="cvi_trigger_btn" class="mes_button interactable" title="上传至自定义视觉模型" style="margin-right: 5px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;">
            <i class="fa-solid fa-eye"></i>
        </div>
    `;
    
    // 尝试注入到不同的地方以确保能显示
    // 优先尝试发送按钮旁边，如果没有发送按钮，则直接加在输入框旁边
    if ($('#send_but').length > 0) {
        $('#send_but').before(buttonHtml);
    } else {
        $('#send_textarea').after(buttonHtml);
    }

    // 绑定点击事件
    $('#cvi_trigger_btn').on('click', () => {
        $('#cvi_file_input').click();
    });

    // 绑定文件选择事件
    $('#cvi_file_input').on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        processSelectedImage(file);
        
        // 清空 input，允许重复选择同一张图片
        $(this).val('');
    });
}

// 插件启动入口 (遵循最新指南建议)
jQuery(async () => {
    try {
        // 使用 getContext 的 renderExtensionTemplateAsync
        const { renderExtensionTemplateAsync } = SillyTavern.getContext();
        
        // 获取配置数据作为 Handlebars 模板的上下文变量
        const extensionSettings = getSettings();
        
        // 渲染设置页面
        const settingsHtml = await renderExtensionTemplateAsync(
            'third-party/STtextimage',
            'settings',
            extensionSettings
        );
        
        // 注入到扩展设置面板
        $('#extensions_settings').append(settingsHtml);

        // 绑定输入框变化与持久化
        bindSettingsUI();
        
        // 等待整个应用 UI 构建完成后，再注入聊天框按钮
        eventSource.on(event_types.APP_READY, () => {
            injectUI();
        });
        
        console.log("[Custom Vision Injector] 插件加载成功。");
    } catch (error) {
        console.error("[Custom Vision Injector] 插件初始化失败:", error);
    }
});
