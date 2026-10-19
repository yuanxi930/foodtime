# 饭点

一个面向午餐、晚餐选择的静态网页原型。页面可以发布在 GitHub Pages；个人添加的店铺、菜单修改、收藏和用餐记录使用 CloudBase 账号在设备间同步。

## 发布到 GitHub Pages

1. 用 GitHub Desktop 选择 **File → Add Local Repository**，添加 `outputs` 文件夹。仓库已经在本机初始化，三个项目文件也已暂存。
2. 在 GitHub Desktop 填写提交说明，例如“饭点跨设备同步”，点击 **Commit to main**，再点 **Publish repository**。
3. 发布时可以选择公开仓库；应用源码不包含个人店铺和用餐记录，个人数据只保存在 CloudBase 的用户档案中。GitHub Pages 网站本身是公开网页。
4. 在 GitHub 仓库的 **Settings → Pages** 中，选择从 `main` 分支的根目录发布。
5. 等待 Pages 发布完成，打开页面右上方的“同步设置”。

如果使用命令行，也可以在该文件夹执行：

   ```powershell
   git init
   git add .
   git commit -m "初始化饭点"
   ```

然后在 GitHub 创建仓库、添加远程地址并推送 `main` 分支。

GitHub Pages 是公开网页托管服务；即使仓库设为私有，Pages 网站也可能公开。不要把账号密码、腾讯云 SecretId/SecretKey 或其他管理员密钥写进代码。

## 配置 CloudBase 数据同步

1. 在腾讯云 CloudBase 创建一个环境，建议使用上海地域（`ap-shanghai`）。记下环境 ID。
2. 在 CloudBase 身份认证中启用邮箱验证码注册和邮箱/密码登录，并完成邮箱发送设置。
3. 在文档型数据库创建集合 `foodtime_profiles`，切换到“安全规则”，设置为：

   ```json
   {
     "read": "doc.uid == auth.uid",
     "write": "doc.uid == auth.uid"
   }
   ```

   网页端会在查询中带上当前用户条件（`uid: '{openid}'`），每个账号只读写自己的档案。不要将集合设为“所有用户可读写”。

4. 在 CloudBase 的安全域名/来源域名设置中加入你的 GitHub Pages 域名，例如 `你的用户名.github.io`。使用自定义域名时也要加入自定义域名。`file://` 适合离线查看和导入导出，但 CloudBase 请求应从已加入白名单的 HTTPS 网页发起。
5. 打开 Pages 页面，点“同步设置”，填入环境 ID。首次使用可用邮箱验证码创建账号；在第二台设备登录同一个账号即可同步。

登录后，页面会在本机改动后自动保存到云端，并在页面重新显示或切回前台时同步；页面打开期间每 60 秒检查一次更新。用餐记录按记录去重合并，店铺按店铺 ID 合并；两台设备同时修改同一店铺字段时，以后保存的修改为准。

## 把旧页面里的本机数据迁移到 GitHub Pages

浏览器会按网页地址分别保存本机数据，因此 `file://` 页面和 GitHub Pages 的本机存储互不相通：

1. 用更新后的 `index.html` 打开原来的本机页面，点“同步设置”→“导出本机数据”。
2. 在 GitHub Pages 页面点“同步设置”→“导入 JSON 备份”。
3. 再用同一 CloudBase 账号登录。导入的店铺、菜单、收藏和用餐记录会合并并上传。

也可以先在 Pages 登录，再导入备份；导入完成后会自动排队同步。

## 项目文件

- `index.html`：应用界面和餐饮原型数据。
- `cloud-sync.js`：CloudBase 登录、个人数据同步和本机备份导入导出。

CloudBase 环境 ID 存在当前浏览器本机，不写入 Git；登录密码只提交给 CloudBase SDK，不保存在应用数据或仓库中。

## 官方文档

- [CloudBase Web SDK 初始化](https://docs.cloudbase.net/api-reference/webv2/initialization)
- [CloudBase Web SDK 身份认证](https://docs.cloudbase.net/api-reference/webv2/authentication_v2)
- [CloudBase 数据库增删改查](https://docs.cloudbase.net/api-reference/webv2/database)
- [CloudBase 数据库安全规则](https://docs.cloudbase.net/database/security-rules)
- [GitHub Pages 简介](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
