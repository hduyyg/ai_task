#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
代码开发节点 - 根据 claude.md 需求开发指引进行实际代码开发
"""

import logging
import os
from typing import Optional, List
from utils import git_utils
import shutil
import time
import re
import json
from .node_info import TableValue, LinkItem, FlowNode, NodeField
from .base_node import BaseNode
from config.config_model import GitRepoConfig

logger = logging.getLogger(__name__)


class CodeDevelopNode(BaseNode):
    """代码开发节点"""
    
    node_name = "代码开发"
    node_key = "code_develop"
    execute_unique_key = None

    # ========== 目录路径属性 ==========

    @property
    def work_dir(self) -> str:
        """工作目录（按节点+任务隔离）"""
        dir_path = os.path.join(self.client_config.cache_dir, self.node_key)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
        dir_path = os.path.join(dir_path, self.task.key)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
        return dir_path

    @property
    def git_repo_cache_dir(self) -> str:
        """代码仓库缓存目录（全局共享）"""
        dir_path = os.path.join(self.client_config.cache_dir, "git_repo_cache")
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
        return dir_path

    @property
    def docs_dir(self) -> str:
        """文档仓库中当前任务的目录"""
        dir_path = os.path.join(self.work_dir, self.docs_repo_name)
        if not os.path.exists(dir_path):
            raise Exception(f"文档仓库目录 {dir_path} 不存在")
        dir_path = os.path.join(dir_path, self.task.key)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
        return dir_path

    @property
    def current_execute_record_dir_path(self) -> str:
        """当前执行记录的保存目录（用于保存执行信息、Agent交互记录等）"""
        if not self.execute_unique_key:
            raise Exception("执行唯一key不存在")
        dir_path = os.path.join(self.docs_dir, self.execute_unique_key)
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
        return dir_path

    # ========== 文档仓库信息属性 ==========

    @property
    def docs_repo_name(self) -> str:
        """文档仓库名称"""
        return self.client_config.docs_git.name

    @property
    def docs_branch(self) -> str:
        """文档仓库分支名称"""
        return self.client_config.docs_git.branch_prefix + str(self.task.id)

    @property
    def docs_branch_formatted(self) -> str:
        """格式化的文档仓库分支名称（用于目录命名，仅保留字母数字）"""
        return re.sub(r'[^a-zA-Z0-9]', '_', self.docs_branch)

    # ========== 文件路径属性 ==========

    @property
    def knowledge_file_path(self) -> str:
        """知识库文件路径"""
        return os.path.join(self.work_dir, "knowledge.md")

    @property
    def claude_file_path(self) -> str:
        """claude.md 文件路径"""
        return os.path.join(self.work_dir, "claude.md")

    @property
    def develop_plan_example_file_path(self) -> str:
        """开发计划示例文件路径"""
        return os.path.join(self.work_dir, "develop_plan_example.md")

    @property
    def develop_file_path(self) -> str:
        """开发文档路径（本次任务的执行结果）"""
        return os.path.join(self.docs_dir, 'develop.md')

    @property
    def git_push_info_file_path(self) -> str:
        """Git推送信息文件路径，格式: {repo_name: commit_message}"""
        return os.path.join(self.docs_dir, 'git_push.json')

    def execute_for_pending(self, trace_id: str):
        """执行节点逻辑 - 待处理"""
        prompt = self._build_development_prompt()
        success, reply = self.client_config.agent.run_prompt(
            trace_id=trace_id,
            cwd=self.work_dir,
            prompt=prompt,
            input_save_file_path=os.path.join(self.current_execute_record_dir_path, 'agent_prompt.md'),
            output_save_file_path=os.path.join(self.current_execute_record_dir_path, 'agent_reply.md'),
        )
        if not success:
            raise Exception(f"[{trace_id}] Agent 执行失败: {reply}")

    def execute_for_revising(self, trace_id: str):
        """执行节点逻辑 - 根据用户审核意见，进行修订"""
        self.execute_for_pending(trace_id)

    def execute_for_reviewed(self, trace_id: str):
        """执行节点逻辑 - 已审核通过"""
        prompt = self._build_merge_prepare_prompt()
        success, reply = self.client_config.agent.run_prompt(
            trace_id=trace_id,
            cwd=self.work_dir,
            prompt=prompt,
            input_save_file_path=os.path.join(self.current_execute_record_dir_path, 'agent_prompt.md'),
            output_save_file_path=os.path.join(self.current_execute_record_dir_path, 'agent_reply.md'),
        )
        if not success:
            raise Exception(f"[{trace_id}] Agent 执行失败: {reply}")

    def before_execute(self, trace_id: str):
        """准备执行节点逻辑 - 准备执行节点所需的环境和数据"""
        # 生成本次执行的唯一key
        self.execute_unique_key =  time.strftime("%Y%m%d_%H%M%S")
        # 代码仓库缓存更新
        for git_repo in self.client_config.code_git:
            git_result = git_utils.clone_or_sync_repo(work_dir=self.git_repo_cache_dir, repo_config=git_repo)
            if not git_result.success:
                raise Exception(f"代码仓库 {git_repo.name} 准备失败: {git_result.message}")
        # 工作目录仓库同步
        for git_repo in self.client_config.code_git:
            self._sync_repo(git_repo)
        # 文档仓库init_docs拷贝到当前目录，如果没有的话，默认使用当前clients目录下的init_docs
        current_file_dir = os.path.dirname(os.path.abspath(__file__))
        default_init_docs_dir = os.path.join(os.path.dirname(current_file_dir), "init_docs")
        shutil.copytree(default_init_docs_dir, self.work_dir, dirs_exist_ok=True)
        if self.client_config.docs_git:
            repo_init_docs_dir = os.path.join(self.work_dir, self.client_config.docs_git.name, "init_docs")
            if os.path.exists(repo_init_docs_dir):
                shutil.copytree(repo_init_docs_dir, self.work_dir, dirs_exist_ok=True)

    def after_execute(self, trace_id: str) -> str:
        """执行完成后，保存任务执行信息"""
        docs_link_list: List[LinkItem] = []
        if self.client_config.docs_git:
            docs_path_prefix = self.client_config.docs_git.get_path_prefix(self.docs_branch) + "/" + self.task.key
            docs_link_list.append(LinkItem(label="开发文档", url=docs_path_prefix + "/develop.md"))
            docs_link_list.append(LinkItem(label="agent回复", url=docs_path_prefix + f"/{self.execute_unique_key}/agent_reply.md"))
        # 推送git修改到云端仓库
        git_push_info_table = TableValue(
            headers=['项目名称', '分支', 'Merge Request', '状态', '额外信息'],
            rows=[]
        )
        # 读取 git_push.json，如果文件不存在则使用空字典
        if os.path.exists(self.git_push_info_file_path):
            with open(self.git_push_info_file_path, 'r', encoding='utf-8') as f:
                git_push_info = json.load(f)
        else:
            git_push_info = {}
        for git_repo in self.client_config.code_git:
            work_repo_dir = os.path.join(self.work_dir, git_repo.name)
            if not os.path.exists(work_repo_dir):
                continue
            dev_branch = git_repo.branch_prefix + str(self.task.id)
            commit_msg=git_push_info.get(git_repo.name, 'feat: [AI Task] modify')
            mr_url = git_repo.get_mr_url(dev_branch)
            repo_web_url = git_repo.get_web_url()
            mr_display = f"[查看MR]({mr_url})" if mr_url else '请手动提交MR'
            repo_display = f"[{git_repo.name}]({repo_web_url})" if repo_web_url else '请手动查看仓库'
            git_result = git_utils.commit_and_push_changes(repo_dir=work_repo_dir, commit_msg=commit_msg, default_branch=git_repo.default_branch)
            if not git_result.success:
                git_push_info_table.rows.append([repo_display, dev_branch, mr_display, 'failed', git_result.message])
            elif git_result.diff_message:
                git_push_info_table.rows.append([repo_display, dev_branch, mr_display, 'success',  ''])
        # 保存更新信息到云端
        node = FlowNode(
            id=self.node_key,
            label=self.node_name,
            type=self.node_key,
            status='done',
            fields=[
                NodeField(
                    key='docs_link',
                    value=docs_link_list,
                    field_type='link_list',
                    label='生成文档',
                    required=True
                ),
                NodeField(
                    key='git_push_info_table',
                    value=git_push_info_table,
                    field_type='table',
                    label='git推送信息',
                    required=True
                )
            ]
        )
        if 'nodes' in self.task.flow:
            self.task.flow['nodes'].append(node.to_dict())
        else:
            self.task.flow['nodes'] = [node.to_dict()]
        # 注意：不在这里调用 update_task_flow，由 base_node._execute_and_persist 统一更新 flow 和 flow_status

    def _sync_repo(self, git_repo: GitRepoConfig):
        work_repo_dir = os.path.join(self.work_dir, git_repo.name)
        if not os.path.exists(work_repo_dir):
            src_repo_dir = os.path.join(self.git_repo_cache_dir, git_repo.name)
            shutil.copytree(src_repo_dir, work_repo_dir, dirs_exist_ok=True)
        dev_branch = git_repo.branch_prefix + str(self.task.id)
        git_result = git_utils.sync_and_rebase_branch(repo_dir=work_repo_dir, dev_branch=dev_branch, default_branch=git_repo.default_branch)
        if git_result.success:
            return
        if 'conflict' not in git_result.message.lower():
            raise Exception(f"{work_repo_dir} 同步并 rebase 失败: {git_result.message}")

        """Agent 处理 rebase 冲突"""
        prompt = f"""当前分支 `{dev_branch}` 与云端分支 `{git_repo.default_branch}` 存在冲突，请解决冲突并提交。

## 操作步骤
1. 查看冲突文件：`git status`
2. 分析并解决每个冲突文件
3. 添加已解决的文件：`git add <file>`
4. 继续 rebase：`git rebase --continue`
5. 如果有更多冲突，重复步骤 1-4

## 返回格式
请返回以下 JSON 结构：
{{
    "success": true/false,
    "msg": "执行成功的描述" 或 "执行失败的原因"
}}

**重要**：直接返回纯 JSON 字符串，可被 json.loads() 直接解析。禁止使用 ```json 等 markdown 代码块包裹。"""
        
        success, reply = self.client_config.agent.run_prompt(
            trace_id="agent_rebase_conflict", 
            cwd=work_repo_dir, 
            prompt=prompt,
            json_parse=True
        )
        if not success:
            raise Exception(f"Agent 处理 rebase 冲突失败: {reply}")
        
        # reply 已经是解析后的 dict
        if not reply.get('success', False):
            raise Exception(f"解决冲突失败: {reply.get('msg', '未知错误')}")

    def _build_development_prompt(self) -> str:    
        """构建跨多项目开发 prompt"""
        develop_file_exists = os.path.exists(self.develop_file_path)
        knowledge_file_exists = os.path.exists(self.knowledge_file_path)
        
        prompt = f"""# 开发任务指令

## 核心规则（强制）

**⚠️ 在执行任何操作前，必须先完善开发文档 {self.develop_file_path} 最上方的「需求内容」章节。**

| 规则 | 说明 |
|------|------|
| ⛔ 分支管理 | **严禁在主分支（main/master）上进行开发！** 必须在当前项目分支上直接进行开发，不要切换分支、不要新建分支 |
| 需求迭代 | 初始任务信息仅为起点，每次执行需根据当前文档和代码状态、用户反馈补充完善需求描述 |
| 文档优先 | 需求内容是多次反馈迭代的累积记录，确保需求完整清晰 |

---

## 执行流程

"""
        # Step 1: 知识库
        if knowledge_file_exists:
            prompt += f"""### Step 1: 阅读知识库（强制）

```
路径: {self.knowledge_file_path}
```

理解项目背景、架构设计、已有约定。

"""
        else:
            prompt += """### Step 1: 知识库（跳过）

知识库文档不存在，跳过此步骤。

"""
        
        # Step 2: 项目仓库
        prompt += f"""### Step 2: 了解项目仓库

{self._build_repo_info_table_for_prompt()}

---

"""
        # Step 3: 开发文档处理（条件分支）
        if develop_file_exists:
            prompt += f"""### Step 3: 执行开发（develop.md 已存在）

```
开发文档: {self.develop_file_path}
```

**执行步骤：**
1. 阅读开发文档 {self.develop_file_path}，理解当前任务目标
2. 按文档中的技术方案和实现步骤进行代码开发
3. 如需调整方案，同步更新开发文档 {self.develop_file_path}

"""
        else:
            prompt += f"""### Step 3: 制定开发计划（develop.md 不存在）

**任务输入：**
```
{self.task_basic_info}
```

**输出要求：**

| 项目 | 要求 |
|------|------|
| 输出目录 | `{self.docs_dir}` |
| 输出文件 | `{self.develop_file_path}` |
| 文档模板 | 参照 `develop_plan_example.md` |

"""
        
        # Step 4: 用户反馈处理
        if self.user_feedback:
            prompt += f"""### Step 4: 处理用户反馈（优先级最高）

**反馈内容：**
```
{self.user_feedback}
```

**处理流程：**
1. 更新开发文档 {self.develop_file_path} 的「需求内容」章节，整合反馈要点
2. 评估是否需要调整技术方案
3. 按更新后的文档执行代码修改

---

"""
        
        # 工作规范
        prompt += f"""## 工作规范

| 规范 | 说明 |
|------|------|
| 文档输出目录 | `{self.docs_dir}` |
| 工作流指引 | 阅读 `claude.md` |
| 开发文档模板 | 参照 `develop_plan_example.md` |

---

## 任务完成后（强制）

开发完成后，执行以下操作：

1. 对所有修改过的 git 仓库，提交修改并推送到云端
2. 将提交信息保存到 `{self.git_push_info_file_path}`

**提交信息格式（写入文件的内容必须是纯 JSON，可以直接被 json.loads() 解析，禁止使用 ```json 代码块包裹）：**
{{
    "repo_name_1": "commit message 1",
    "repo_name_2": "commit message 2"
}}
"""
        
        return prompt

    def _build_merge_prepare_prompt(self) -> str:
        """构建代码合并准备的 prompt"""
        
        prompt = f"""# Git 提交整理

## 仓库信息

{self._build_repo_info_table_for_prompt()}

## 任务目标

对工作目录下每个有修改的 git 仓库：将所有 commit 合并为一个，rebase 主分支，解决冲突，推送到远程。

## 执行流程

对每个仓库执行（无修改则跳过）：

```
1. 暂存并提交未提交的修改
   git add -A && git commit -m "[AI Task] WIP" (如有)

2. 检查是否有差异
   git log origin/<主分支>..HEAD --oneline
   若无差异 → 跳过此仓库

3. 生成 commit message
   - 查看: git diff origin/<主分支>..HEAD --stat
   - 格式: "[AI Task] <修改内容总结>"

4. 合并为单个 commit
   git reset --soft origin/<主分支>
   git commit -m "<commit message>"

5. Rebase 主分支
   git fetch origin <主分支>
   git rebase origin/<主分支>
   - 有冲突 → 解决冲突后 git rebase --continue
   - 冲突无法解决 → git rebase --abort

6. 推送到远程
   git push -f origin $(git branch --show-current)
```
"""
        return prompt

    def _build_repo_info_table_for_prompt(self) -> str:
        """
        构建项目仓库信息（列表格式），用于提示中展示项目仓库信息
        """
        blocks = []
        for repo in self.client_config.code_git:
            name = repo.name
            branch = repo.default_branch or '-'
            desc = repo.desc or '-'
            block = f"**{name}** (主分支: {branch})\n用途说明: {desc}"
            blocks.append(block)
        
        return "\n\n".join(blocks)