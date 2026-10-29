# Usage guide

[Home](../README.en.md) · [简体中文](usage.md)

**Contents**

- [What does "full chain" mean?](#section-1)
- [Usage](#section-2)
- [Engagement mode](#section-3)
- [Approval](#section-4)
- [POC feeds](#section-5)
- [Plugin center](#section-6)
- [How to use it](#section-7)
- [How to develop plugins](#section-8)

---

<a id="section-1"></a>

## What does "full chain" mean?

Security-service penetration testing usually falls into three categories:

**1. Web penetration testing 2. Mini-program penetration testing 3. App penetration testing**

This project connects all three, so one platform covers every task.

How are the three connected? Ask what penetration testing actually tests. Many people misunderstand this: about 90% of penetration testing targets the server backend. The backend exists to present something to the frontend, so connecting the three is only a matter of the delivery vehicle:

**Web**: the frontend runs in a browser.

**Mini-programs**: the frontend runs in a mini-program container.

**Apps**: the frontend runs in a UI framework.

In essence, Web, mini-programs, and apps are the same.

<a id="section-2"></a>

## Usage

Create a project before using the console; otherwise it cannot be used.
![](../images/Pasted%20image%2020261017124002.png)

![](../images/Pasted%20image%2020261017124018.png)

A few common scenarios:

1. **Web testing**
   Use the input box directly.

2. **Mini-programs**
   Select a preset agent, decompile the WeChat mini-program with a tool such as Tscan, and upload the result with the attachment control at the lower left.

3. **Apps**
   Configure your Android device under Android devices in the left sidebar, install the target app on the device, and select "Android" in that conversation's chat box. The toggle is per conversation: enabling it in one chat does not mount Android tools in another.

![](../images/Pasted%20image%2020261017124047.png)

The design goal is to use fewer tools and less context. If you do not enable the "Android" toggle for a conversation, Android-related tool calls and prompts are not inserted there.

<a id="section-3"></a>

## Engagement mode

For batch testing. It uses a commander architecture for multi-task orchestration and is still experimental; try it at your own risk.

![](../images/Pasted%20image%2020261017124651.png)

<a id="section-4"></a>

## Approval

Configure a small model under Settings → Models, for example Qwen. It hooks every bash call. Pay-as-you-go Qwen API access is recommended; do not use CodingPlan models because CodingPlan has rate limits.

https://www.qianwenai.com/models/qwen-flash

Using a small model to supervise a large one minimizes the impact on production environments.

The "Approval" item in the sidebar has two tabs. "AI Approval" is the Gatekeeper decision log (verdict, reason, duration, model). "Auto Approval" is the log of calls that no one judged: Auto mode, manual allow/block in Approval mode, and tools not covered by the Gatekeeper (read / edit / write, or when the MCP switch is off). Every bash, MCP, and plugin call leaves one record. Together the two tabs cover every call exactly once and support filtering by project, session, source, time, and keyword.

![](../images/Pasted%20image%2020261017125228.png)

<a id="section-5"></a>

## POC feeds

You can run your own Nuclei POC feed service and add it under Settings → POC feeds. The main use case is n-day testing. A built-in Nuclei POC feature was not originally planned, but custom API routes in frameworks such as Jeecg Boot and RuoYi made it worthwhile.

On your remote server, periodically package all Nuclei POCs into a zip and synchronize it remotely.

You can also synchronize the official Nuclei POCs directly.

![](../images/Pasted%20image%2020261017125244.png)

<a id="section-6"></a>

## Plugin center

<a id="section-7"></a>

### How to use it

Full Chain Sentinel abstracts a "plugin" so different plugins can run on different hosts.

For example, if Sentinel is deployed locally but you need public-network capabilities such as a public MSF, copy Sentinel to your VPS and run:

```
./sentinel-web plugin-host --listen 0.0.0.0:7800
```

Then add it under Settings → Plugins.

<img src="../images/Pasted%20image%2020261017233410.png" alt="Plugin center" width="900" />

<a id="section-8"></a>

### How to develop plugins

On the plugin development documentation page, copy the full text, give it to an AI, and describe what you need.

<img src="../images/Pasted%20image%2020261017233500.png" alt="Plugin development documentation" width="900" />

You can also refer to the example plugin "memshell-party" in this repository.

More: [Plugin center](plugin-center.md) · [Plugin authoring](plugin-authoring.md) · [Plugin UI](plugin-ui.md) · [Asset library](asset-library.md).
