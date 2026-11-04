# 上架 dsh 插件市场 —— 全流程

先把三条通道的关系理清楚，否则很容易投错仓库：

| 东西 | 是什么 | 你要做什么 |
| --- | --- | --- |
| [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | **唯一的插件目录数据源**（精选列表，`data/plugins/*.yml`） | **投稿就是往这里提 PR** |
| [`dsh-market`](https://github.com/dsh-market/dsh-market)（`dshmarket` 包） | 装在 Harness 里的**市场 UI 应用**，实时读上面的目录 | **不用投**（它的 README 明确写着别往它仓库投） |
| dsh 0.2.1+ **插件 → 发现 → 索引源** | 官方 Discover 页，读取同一份目录的 npm 版索引 `dsh-plugin-catalog` | **不用投**（同上，随目录自动更新） |

数据流：`data/plugins/*.yml` → CI 生成 README / `plugins.json` / npm 上的 format-1 索引 → dsh-market 与官方 Discover 一起读到。**所以只有一件事要做：往 awesome-dsh-plugin 加一个 YAML 文件。**

---

## 0. 当前状态（我已核对）

| 检查项 | 结果 |
| --- | --- |
| `package.json` 声明 `dsh.bundle.patch` | ✅ 有（`./cordis.patch.yml`），且已实测可被 `dsh plugin add` 安装 |
| `cordis.patch.yml` 在仓库根 | ✅ 有 |
| 真实可用代码 + 实测证据 | ✅ 21 个离线用例、4 个真实模型场景、Web UI 两轮，证据在 `verify/` 与 `docs/` |
| 市场卡片图标 | ✅ `assets/icon.png`（180×180，`scripts/make-icon.py` 可重生成） |
| CI | ✅ `.github/workflows/ci.yml`（Node 20/22/24：build + 校验 `lib/` 与源码一致 + 离线测试） |
| npm 包名 `dsh-multi-model-collab` | ✅ **未被占用**（`npm view` 返回 404） |
| 本机 npm 登录 | ❌ 未登录（`npm whoami` → `ENEEDAUTH`），需要你自己 `npm login` |
| Git 仓库 | ✅ 已 `git init -b main` 并**提交了一次**（见 §1）；只差远端与 push |
| GitHub 仓库 | ❌ 还没有。**必须先有仓库，且创建满 1 天**，这是 CI 硬性检查 |

---

## 1. 建远端仓库并推送（两条命令，已脚本化）

**前提**：GitHub 自 2021-08 起**不再接受账号密码**做 git/API 认证，必须用 **Personal Access Token**。
（本机已核实：没有 credential helper、`ssh -T git@github.com` 返回 `Permission denied (publickey)`、没有 `GITHUB_TOKEN`，
所以这一步必须由你提供 token —— 它不该出现在聊天记录里，请只放进当前 shell 的环境变量。）

**第一步：生成 token**（只做这一次）
GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token

| 设置项 | 值 | 为什么 |
| --- | --- | --- |
| Repository access | **All repositories**（首次，仓库还不存在） | 创建仓库需要 administration 权限 |
| Permissions → Contents | **Read and write** | 推送代码 |
| Permissions → Administration | **Read and write** | 通过 API 创建仓库 |
| Expiration | 7 天 | 用完即弃 |

再做一次 fork 用的 token 或把同一个 token 的 **Public repositories** 也放开（`publish:market` 要 fork 公共列表）。

**第二步：一条命令发完**（建仓 → push → 加 `dsh-plugin` topic → 回填 `package.json` 仓库地址并提交推送）

```powershell
cd "D:\deepseek harness\任务13_多模型插件"
$env:GITHUB_TOKEN = (Read-Host "GitHub PAT" -AsSecureString | ConvertFrom-SecureString -AsPlainText)
npm run publish:github
Remove-Item Env:\GITHUB_TOKEN     # 立刻从当前会话清掉
```

（Windows PowerShell 5.1 没有 `-AsPlainText`，改用：
`$env:GITHUB_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host "GitHub PAT" -AsSecureString)).Password`）

想先看它会干什么、不产生任何副作用：`npm run publish:github -- --dry-run`。

脚本做了什么、以及为什么 token 不会泄漏：

- token 只经 `git -c http.extraheader=...` 传给**单次** push，不写 `.git/config`、不进 remote URL、不落 shell 历史、不打印；
- 先用 `GET /user` 识别账号，再 `POST /user/repos` 建公开仓库（已存在则复用）；
- 推送前检查工作区必须干净、打印 commit 与文件数；
- topic 用 `PUT /repos/{owner}/{repo}/topics` 设置，包含 `dsh-plugin`（收录硬性要求）；
- 最后写入 `repository` / `homepage` / `bugs` 并提交推送。

完成后**去 Settings 吊销这个 token**。

### 手动方式（不想跑脚本时）

```powershell
# 1) 在 GitHub 网页新建空仓库 <owner>/dsh-multi-model-collab（不要勾 README / .gitignore / license）
# 2) 关联并推送（Username = GitHub 用户名，Password = PAT）
git remote add origin https://github.com/<owner>/dsh-multi-model-collab.git
git push -u origin main
# 3) 仓库首页 → About 齿轮 → 加 topic: dsh-plugin
```

> `.gitignore` 已排除 `node_modules/`、`tools/ref/`、`verify/ref/` 和几个大文件（2.8 MB 的 asar 清单、639 KB 的 DOM dump）。`lib/` 是**故意提交**的：运行时入口就是它。

## 2. 发布到 npm（强烈建议，但非强制）

市场索引对「npm 上有已知版本」的插件能给出准确的版本与一键更新；纯 GitHub 条目只是保留列表里那行安装命令。

```powershell
npm login                 # 需要你自己的账号
npm publish --access public
# 验证：
npm view dsh-multi-model-collab version
```

`prepack` 会自动跑 `npm run build`（tsc → `lib/`），发布物只有 9 个文件 / 约 46 KB（含图标）。

## 3. 提 PR：加一个 YAML 文件（这就是全部投稿）

**一条命令**（自动 fork → 写 `data/plugins/<owner>__<repo>.yml` → 开 PR，并打印 PR 链接）：

```powershell
$env:GITHUB_TOKEN = (Read-Host "GitHub PAT" -AsSecureString | ConvertFrom-SecureString -AsPlainText)
npm run publish:market
Remove-Item Env:\GITHUB_TOKEN
```

token 需要能 fork 公共仓库（fine-grained token 里把 **Public repositories** 放开，或直接用 classic token 的 `public_repo`）。
想先看要提交的 YAML 和计划而不发任何请求：`npm run publish:market -- --dry-run`（会先本地校验
`category` 合法、`description.en` 以句号结尾、不含未加引号的 `: `，校验不过就不发请求）。

下方的文件格式就是脚本生成的内容，手工 fork + 提 PR 也走同一套：

Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`，在 `data/plugins/` 下**新增一个文件**（不要手改 README——两个 README 都是脚本生成的）：

文件名：`data/plugins/<owner>__<repo>.yml`，例如 `data/plugins/yourname__dsh-multi-model-collab.yml`

```yaml
url: https://github.com/<owner>/dsh-multi-model-collab   # 必须与仓库完全一致
name: <owner>/dsh-multi-model-collab
category: model
description:
  en: Runs one task through several configured models at once — in parallel or as a primary/secondary review — and returns each model's answer plus an aggregated digest.
  zh: 把一个任务同时交给多个已配置模型（并行，或主模型起草 + 副模型复核），返回各模型答案与聚合摘要。
# 可选但建议：市场卡片图标（GitHub 托管的位图）；不写则回退到作者头像
icon: https://raw.githubusercontent.com/<owner>/dsh-multi-model-collab/main/assets/icon.png
```

要点：

- **只有 `description.en` 是必填的**；写不了中文就留空，维护者会补。
- **描述里出现 `: `（冒号+空格）必须加引号**，否则 YAML 解析失败。上面能不加引号是因为没有 `: `。
- **描述必须属实**，维护者会对着代码核对数字和 API 名。上面这句只说了"并行 / 主副复核 / 返回各模型答案与聚合摘要"，与实现一致；不要写"支持 N 家供应商"之类未经测试放大。
- 分类取最接近的一个即可，**选不准不会被打回**（维护者会改）。本插件可选 `model`（模型与供应商）或 `tools`（工具）；`model` 更贴合"多模型协同"。
- 官方分类取值：`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`。

PR 标题随意，正文建议写清三件事：装什么（`dsh plugin add dsh-multi-model-collab`）、做什么（一句话）、怎么验证（`docs/acceptance-evidence.md` 里的四场景 + Web UI 截图）。

## 4. 等评审与上线

- CI 先跑：校验 manifest、仓库年龄（≥1 天）、YAML 格式、README 能否重新生成。
- 然后维护者**实际读代码**：是否名副其实、分类是否合理、是否与已有条目重复、源码有无混淆/外传凭据。
- 合并后 `main` 上自动重新生成 README 与索引；市场与站点**通常一天内**出现。

## 5. 上线后怎么验证

```powershell
# 官方 Discover 索引（dsh 0.2.1+）：插件 → 发现 → 索引源，添加
#   https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json

# dsh-market 市场里搜 "multi model"
dsh plugin --profile desktop add dshmarket

# 最直接的安装验证
dsh plugin --profile desktop add dsh-multi-model-collab
```

---

## 需要你自己做的 / 我能代做的

**必须你本人操作**（涉及你的账号与授权）：`npm login`、创建 GitHub 仓库与 push、给仓库加 topic、fork 并提 PR。

**我可以马上代做**（说一声即可）：

1. 就地把 git 提交好（你把身份告诉我，或你自己执行上面 `git config` 两行后我提交）；
2. 生成 180×180 的市场卡片图标并加进 `assets/`；
3. 把 `cordis.patch.yml` 的插入行改成目录约定的裸包名形式 `name: dsh-multi-model-collab`；
4. 起草 PR 描述（中英）与 `data/plugins/*.yml` 文件实体。

### 关于 `cordis.patch.yml` 的一处刻意偏离

目录的 contributing 示例写的是裸包名：

```yaml
- insert:
    - id: your-plugin-id
      name: your-package-name
```

本项目用的是**锚定在 patch 文件旁的相对入口**：

```yaml
- insert:
    - id: multi-model-collab
      name: ./lib/index.js
```

原因：这样同一个文件既能作为**已安装 bundle 的 patch 层**（`dsh plugin add` 后实测解析到
`file:///…/profiles/<p>/node_modules/dsh-multi-model-collab/lib/index.js`，工具真实可调），
又能直接用于工作区里的 `dsh web --patch ./cordis.patch.yml`（裸包名在这种未安装场景会
`ERR_MODULE_NOT_FOUND`，已实测）。两种安装路径都验证过；若维护者更希望与目录约定一致，
改成裸包名是一行的事（改动后工作区 `--patch` 流程需要先安装）。
