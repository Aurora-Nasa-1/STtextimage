import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

// 插件标识
const extensionName = 'custom_vision_injector';
const extensionFolderPath = `scripts/extensions/${extensionName}`;

// 默认设置
const defaultSettings = {
    apiUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    apiKey: '',
    modelId: 'llava',
    prompt: 'Please describe this image in detail. Focus on the main subjects and the environment.',
    template: '\n[System Note: The user shared an image. Description: {{caption}}]\n'
};

// 初始化设置
async function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { ...defaultSettings };
    }
    const settings = extension_settings[extensionName];
    
    $('#cvi_api_url').val(settings.apiUrl);
    $('#cvi_api_key').val(settings.apiKey);
    $('#cvi_model_id').val(settings.modelId);
    $('#cvi_prompt').val(settings.prompt);
    $('#cvi_template').val(settings.template);

    // 绑定设置改变事件并保存
    $('#cvi_api_url, #cvi_api_key, #cvi_model_id, #cvi_prompt, #cvi_template').on('input', function () {
        settings.apiUrl = $('#cvi_api_url').val();
        settings.apiKey = $('#cvi_api_key').val();
        settings.modelId = $('#cvi_model_id').val();
        settings.prompt = $('#cvi_prompt').val();
        settings.template = $('#cvi_template').val();
        saveSettingsDebounced();
    });
}

// 图片转 Base64
function getBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// 调用自定义视觉 API (使用标准 OpenAI 多模态格式)
async function callCustomVisionAPI(base64Image) {
    const settings = extension_settings[extensionName];
    
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
            throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
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
        // 1. 转为 Base64
        const base64Image = await getBase64(file);
        
        // 2. 调用 API 获取描述
        const caption = await callCustomVisionAPI(base64Image);
        
        if (caption) {
            // 3. 格式化并注入到输入框
            const settings = extension_settings[extensionName];
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

    // 在 ST 的聊天输入框旁边添加一个按钮 (使用 ST 自带的 FontAwesome 图标)
    // 注入到 #send_controls 容器内
    const buttonHtml = `
        <div id="cvi_trigger_btn" class="mes_button interactable" title="上传至自定义视觉模型" style="margin-right: 5px;">
            <i class="fa-solid fa-eye"></i>
        </div>
    `;
    
    // 寻找发送按钮容器并插入
    $('#send_controls').prepend(buttonHtml);

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

// 插件启动入口
jQuery(async () => {
    // 加载设置 HTML
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $('#extensions_settings').append(settingsHtml);

    // 初始化
    await loadSettings();
    injectUI();
    
    console.log("[Custom Vision Injector] 插件加载成功。");
});
