#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Git 仓库 Shell 工具
提供 Git 仓库的克隆、更新、同步等功能
"""

import logging
import os
import subprocess
from dataclasses import dataclass
from typing import Optional

from config.config_model import GitRepoConfig

logger = logging.getLogger(__name__)


@dataclass
class GitResult:
    """Git 操作结果"""
    success: bool
    message: str = ""
    default_branch: str = ""  # 获取到的默认主分支名称（如果之前配置为空）
    diff_message: str = ""  # 是否与主分支存在差异


def clone_or_sync_repo(
    work_dir: str,
    repo_config: GitRepoConfig,
    timeout_clone: int = 300,
    timeout_cmd: int = 60
) -> GitResult:
    """
    克隆或同步 Git 仓库
    
    流程:
    1. 如果仓库已存在则跳过克隆，否则执行 git clone
    2. 切换到默认主分支（如果配置中没有默认主分支，则获取远端默认分支名称）
    3. 强制更新本地仓库与远端保持一致（git restore . && git clean -fd && git pull）
    
    Args:
        work_dir: 工作目录（仓库将下载到此目录下）
        repo_config: Git 仓库配置
        timeout_clone: 克隆超时时间（秒）
        timeout_cmd: 普通命令超时时间（秒）
        
    Returns:
        GitResult: 包含 success, message, default_branch
    """
    repo_name = repo_config.name
    repo_dir = os.path.join(work_dir, repo_name)
    auth_url = repo_config.get_auth_url()
    
    try:
        # 确保工作目录存在
        if not os.path.exists(work_dir):
            os.makedirs(work_dir)
            logger.info(f"创建工作目录: {work_dir}")
        
        # 步骤1: 克隆或跳过
        if os.path.exists(repo_dir):
            # 检查是否是有效的 git 仓库
            git_dir = os.path.join(repo_dir, '.git')
            if not os.path.exists(git_dir):
                return GitResult(
                    success=False,
                    message=f"目录已存在但不是有效的 Git 仓库: {repo_dir}"
                )
            logger.info(f"仓库已存在，跳过克隆: {repo_dir}")
        else:
            # 执行 git clone
            clone_result = _run_git_command(
                ['git', 'clone', auth_url, repo_dir],
                cwd=work_dir,
                timeout=timeout_clone
            )
            if not clone_result.success:
                return GitResult(
                    success=False,
                    message=f"克隆仓库失败: {clone_result.message}"
                )
            logger.info(f"克隆仓库成功: {repo_dir}")
        
        # 步骤2: 获取或确认默认主分支
        default_branch = repo_config.default_branch
        
        if not default_branch:
            # 配置中没有默认分支，从远端获取
            branch_result = _get_remote_default_branch(repo_dir, timeout_cmd)
            if not branch_result.success:
                return GitResult(
                    success=False,
                    message=f"获取远端默认分支失败: {branch_result.message}"
                )
            default_branch = branch_result.message
            logger.info(f"获取到远端默认分支: {default_branch}")
        
        # 步骤3: 切换到默认主分支
        # 先 fetch 更新远端信息
        fetch_result = _run_git_command(
            ['git', 'fetch', '--all', '--prune'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not fetch_result.success:
            return GitResult(
                success=False,
                message=f"fetch 远端失败: {fetch_result.message}"
            )
        
        # 切换到默认分支
        checkout_result = _run_git_command(
            ['git', 'checkout', default_branch],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not checkout_result.success:
            return GitResult(
                success=False,
                message=f"切换到分支 {default_branch} 失败: {checkout_result.message}"
            )
        logger.info(f"已切换到分支: {default_branch}")
        
        # 步骤4: 丢弃本地所有修改
        # git restore . 恢复工作区修改
        restore_result = _run_git_command(
            ['git', 'restore', '.'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not restore_result.success:
            # restore 可能因为没有修改而"失败"，记录警告但继续
            logger.warning(f"git restore 警告: {restore_result.message}")
        
        # git clean -fd 清理未跟踪的文件和目录
        clean_result = _run_git_command(
            ['git', 'clean', '-fd'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not clean_result.success:
            logger.warning(f"git clean 警告: {clean_result.message}")
        
        logger.info("已丢弃本地所有修改")
        
        # 步骤5: 强制同步远端
        # 使用 git reset --hard origin/<branch> 确保与远端完全一致
        reset_result = _run_git_command(
            ['git', 'reset', '--hard', f'origin/{default_branch}'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not reset_result.success:
            return GitResult(
                success=False,
                message=f"重置到远端分支失败: {reset_result.message}"
            )
        
        logger.info(f"仓库已同步到远端最新: origin/{default_branch}")
        
        return GitResult(
            success=True,
            message=f"仓库同步成功: {repo_dir}",
            default_branch=default_branch
        )
        
    except Exception as e:
        logger.error(f"仓库操作异常: {e}", exc_info=True)
        return GitResult(
            success=False,
            message=f"仓库操作异常: {str(e)}"
        )


def _run_git_command(
    cmd: list,
    cwd: Optional[str] = None,
    timeout: int = 60
) -> GitResult:
    """
    执行 Git 命令
    
    Args:
        cmd: 命令列表
        cwd: 工作目录
        timeout: 超时时间（秒）
        
    Returns:
        GitResult: success 和 message
    """
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.returncode == 0:
            return GitResult(
                success=True,
                message=result.stdout.strip() if result.stdout else ""
            )
        else:
            error_msg = result.stderr.strip() if result.stderr else result.stdout.strip()
            return GitResult(
                success=False,
                message=error_msg
            )
            
    except subprocess.TimeoutExpired:
        return GitResult(
            success=False,
            message=f"命令超时: {' '.join(cmd)}"
        )
    except Exception as e:
        return GitResult(
            success=False,
            message=f"执行命令异常: {str(e)}"
        )


def _get_remote_default_branch(repo_dir: str, timeout: int = 60) -> GitResult:
    """
    获取远端仓库的默认分支名称
    
    Args:
        repo_dir: 仓库目录
        timeout: 超时时间（秒）
        
    Returns:
        GitResult: success 和 message（分支名称）
    """
    # 方法1: 尝试从 remote HEAD 获取
    result = _run_git_command(
        ['git', 'symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
        cwd=repo_dir,
        timeout=timeout
    )
    
    if result.success and result.message:
        # 返回的格式是 origin/main，需要去掉 origin/ 前缀
        branch = result.message
        if branch.startswith('origin/'):
            branch = branch[7:]
        return GitResult(success=True, message=branch)
    
    # 方法2: 如果方法1失败，尝试设置 remote HEAD 后再获取
    set_head_result = _run_git_command(
        ['git', 'remote', 'set-head', 'origin', '--auto'],
        cwd=repo_dir,
        timeout=timeout
    )
    
    if set_head_result.success:
        # 再次尝试获取
        result = _run_git_command(
            ['git', 'symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
            cwd=repo_dir,
            timeout=timeout
        )
        
        if result.success and result.message:
            branch = result.message
            if branch.startswith('origin/'):
                branch = branch[7:]
            return GitResult(success=True, message=branch)
    
    # 方法3: 使用 git branch -r 查看远端分支，尝试找 main 或 master
    branches_result = _run_git_command(
        ['git', 'branch', '-r'],
        cwd=repo_dir,
        timeout=timeout
    )
    
    if branches_result.success:
        branches = branches_result.message
        # 优先查找 main，其次 master
        for preferred in ['origin/main', 'origin/master']:
            if preferred in branches:
                return GitResult(success=True, message=preferred.replace('origin/', ''))
    
    return GitResult(
        success=False,
        message="无法获取远端默认分支"
    )


def sync_and_rebase_branch(
    repo_dir: str,
    dev_branch: str,
    default_branch: str,
    timeout_cmd: int = 60
) -> GitResult:
    """
    同步开发分支并从主分支进行 rebase
    
    流程:
    1. fetch 远端最新信息
    2. 检查云端是否存在开发分支，如果不存在则从主分支创建
    3. 切换到开发分支
    4. 尝试从云端默认主分支进行 rebase
    5. 如果无冲突，执行 git push -f
    6. 如果有冲突，中止 rebase 并返回错误
    
    Args:
        repo_dir: Git 仓库目录
        dev_branch: 开发分支名称
        default_branch: 默认主分支名称
        timeout_cmd: 命令超时时间（秒）
        
    Returns:
        GitResult: 包含 success, message
    """
    try:
        # 检查仓库目录是否存在
        if not os.path.exists(repo_dir):
            return GitResult(
                success=False,
                message=f"仓库目录不存在: {repo_dir}"
            )
        
        git_dir = os.path.join(repo_dir, '.git')
        if not os.path.exists(git_dir):
            return GitResult(
                success=False,
                message=f"目录不是有效的 Git 仓库: {repo_dir}"
            )
        
        # 步骤1: fetch 远端最新信息
        fetch_result = _run_git_command(
            ['git', 'fetch', '--all', '--prune'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not fetch_result.success:
            return GitResult(
                success=False,
                message=f"fetch 远端失败: {fetch_result.message}"
            )
        logger.info("已 fetch 远端最新信息")
        
        # 步骤2: 检查云端是否存在开发分支
        remote_branch_exists = _check_remote_branch_exists(repo_dir, dev_branch, timeout_cmd)
        
        if remote_branch_exists:
            # 云端存在开发分支，切换并同步
            checkout_result = _run_git_command(
                ['git', 'checkout', dev_branch],
                cwd=repo_dir,
                timeout=timeout_cmd
            )
            if not checkout_result.success:
                return GitResult(
                    success=False,
                    message=f"切换到分支 {dev_branch} 失败: {checkout_result.message}"
                )
            
            # 强制同步到云端分支
            reset_result = _run_git_command(
                ['git', 'reset', '--hard', f'origin/{dev_branch}'],
                cwd=repo_dir,
                timeout=timeout_cmd
            )
            if not reset_result.success:
                return GitResult(
                    success=False,
                    message=f"同步到云端分支失败: {reset_result.message}"
                )
            logger.info(f"已同步到云端分支: origin/{dev_branch}")
        else:
            # 云端不存在开发分支，从主分支创建
            # 先切换到主分支
            checkout_default_result = _run_git_command(
                ['git', 'checkout', default_branch],
                cwd=repo_dir,
                timeout=timeout_cmd
            )
            if not checkout_default_result.success:
                return GitResult(
                    success=False,
                    message=f"切换到主分支 {default_branch} 失败: {checkout_default_result.message}"
                )
            
            # 同步主分支到最新
            reset_default_result = _run_git_command(
                ['git', 'reset', '--hard', f'origin/{default_branch}'],
                cwd=repo_dir,
                timeout=timeout_cmd
            )
            if not reset_default_result.success:
                return GitResult(
                    success=False,
                    message=f"同步主分支失败: {reset_default_result.message}"
                )
            
            # 检查本地是否已存在该分支
            local_branch_exists = _check_local_branch_exists(repo_dir, dev_branch, timeout_cmd)
            
            if local_branch_exists:
                # 本地存在，删除后重新创建
                delete_result = _run_git_command(
                    ['git', 'branch', '-D', dev_branch],
                    cwd=repo_dir,
                    timeout=timeout_cmd
                )
                if not delete_result.success:
                    logger.warning(f"删除本地分支失败: {delete_result.message}")
            
            # 从主分支创建开发分支
            checkout_b_result = _run_git_command(
                ['git', 'checkout', '-b', dev_branch],
                cwd=repo_dir,
                timeout=timeout_cmd
            )
            if not checkout_b_result.success:
                return GitResult(
                    success=False,
                    message=f"创建分支 {dev_branch} 失败: {checkout_b_result.message}"
                )
            logger.info(f"已从主分支 {default_branch} 创建开发分支: {dev_branch}")
        
        # 步骤3: 尝试从云端默认主分支进行 rebase
        rebase_result = _run_git_command(
            ['git', 'rebase', f'origin/{default_branch}'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        
        if not rebase_result.success:
            # rebase 失败，检查是否是冲突
            # 中止 rebase
            abort_result = _run_git_command(
                ['git', 'rebase', '--abort'],
                cwd=repo_dir,
                timeout=timeout_cmd
            )
            if not abort_result.success:
                logger.warning(f"中止 rebase 失败: {abort_result.message}")
            
            return GitResult(
                success=False,
                message="rebase conflict"
            )
        
        logger.info(f"rebase 成功: origin/{default_branch}")
        
        # 步骤4: 执行 git push -f
        push_result = _run_git_command(
            ['git', 'push', '-f', 'origin', dev_branch],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not push_result.success:
            return GitResult(
                success=False,
                message=f"push 失败: {push_result.message}"
            )
        
        logger.info(f"已强制推送到云端: origin/{dev_branch}")
        
        return GitResult(
            success=True,
            message=f"分支 {dev_branch} 已成功 rebase 并推送到云端"
        )
        
    except Exception as e:
        logger.error(f"sync_and_rebase_branch 异常: {e}", exc_info=True)
        return GitResult(
            success=False,
            message=f"操作异常: {str(e)}"
        )


def _check_remote_branch_exists(repo_dir: str, branch: str, timeout: int = 60) -> bool:
    """
    检查远端是否存在指定分支
    
    Args:
        repo_dir: 仓库目录
        branch: 分支名称
        timeout: 超时时间（秒）
        
    Returns:
        是否存在
    """
    result = _run_git_command(
        ['git', 'ls-remote', '--heads', 'origin', branch],
        cwd=repo_dir,
        timeout=timeout
    )
    return result.success and branch in result.message


def _check_local_branch_exists(repo_dir: str, branch: str, timeout: int = 60) -> bool:
    """
    检查本地是否存在指定分支
    
    Args:
        repo_dir: 仓库目录
        branch: 分支名称
        timeout: 超时时间（秒）
        
    Returns:
        是否存在
    """
    result = _run_git_command(
        ['git', 'branch', '--list', branch],
        cwd=repo_dir,
        timeout=timeout
    )
    return result.success and branch in result.message


def detect_default_branch_from_url(auth_url: str, timeout: int = 30) -> Optional[str]:
    """
    通过远端 URL 检测 Git 仓库的默认分支（无需本地仓库）
    
    使用 git ls-remote --symref 获取 HEAD 指向的分支
    
    Args:
        auth_url: 带认证信息的仓库 URL
        timeout: 超时时间（秒）
        
    Returns:
        默认分支名称，检测失败返回 None
    """
    try:
        result = subprocess.run(
            ['git', 'ls-remote', '--symref', auth_url, 'HEAD'],
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.returncode != 0:
            logger.error(f"检测默认分支失败: {result.stderr.strip()}")
            return None
        
        # 解析输出，格式类似：
        # ref: refs/heads/main\tHEAD
        # abc123...\tHEAD
        for line in result.stdout.strip().split('\n'):
            if line.startswith('ref:'):
                # 提取分支名称
                parts = line.split()
                if len(parts) >= 2:
                    ref = parts[1]
                    if ref.startswith('refs/heads/'):
                        return ref.replace('refs/heads/', '')
        
        logger.error(f"无法解析默认分支: {result.stdout}")
        return None
        
    except subprocess.TimeoutExpired:
        logger.error(f"检测默认分支超时: {auth_url}")
        return None
    except Exception as e:
        logger.error(f"检测默认分支异常: {e}")
        return None


def _check_diff_with_default_branch(repo_dir: str, default_branch: str, timeout_cmd: int = 60) -> str:
    """
    检查当前分支是否有提交需要合并到主分支
    
    Args:
        repo_dir: Git 仓库目录
        default_branch: 主分支名称
        timeout_cmd: 命令超时时间（秒）
        
    Returns:
        描述信息：有多少个提交需要合并到主分支，或无需合并
    """
    # 获取当前分支名称
    branch_result = _run_git_command(
        ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
        cwd=repo_dir,
        timeout=timeout_cmd
    )
    if not branch_result.success:
        return ""
    current_branch = branch_result.message.strip()
    
    # 如果当前就是主分支，无需合并
    if current_branch == default_branch:
        return ""
    
    # 获取当前分支领先主分支的提交数（即需要合并到主分支的提交数）
    diff_stat_result = _run_git_command(
        ['git', 'rev-list', '--count', f'origin/{default_branch}..{current_branch}'],
        cwd=repo_dir,
        timeout=timeout_cmd
    )
    if diff_stat_result.success:
        ahead = int(diff_stat_result.message.strip())
        if ahead == 0:
            return ""
        else:
            return f"有 {ahead} 个提交需要合并到 {default_branch}"
    return ""


def commit_and_push_changes(
    repo_dir: str,
    commit_msg: str,
    default_branch: str,
    timeout_cmd: int = 60
) -> GitResult:
    """
    检查当前分支是否有未提交的修改，如果有则提交并推送到云端
    
    流程:
    1. 检查是否有未提交的修改（包括未暂存和已暂存的修改）
    2. 如果有修改，执行 git add -A
    3. 执行 git commit
    4. 执行 git push 推送到云端
    
    Args:
        repo_dir: Git 仓库目录
        commit_msg: 提交信息
        default_branch: 主分支名称，用于检查差异
        timeout_cmd: 命令超时时间（秒）
        
    Returns:
        GitResult: 包含 success, message
            - 如果没有修改，success=True, message="没有需要提交的修改"
            - 如果提交推送成功，success=True, message="提交并推送成功"
            - 如果失败，success=False, message=错误信息
    """
    try:
        # 检查仓库目录是否存在
        if not os.path.exists(repo_dir):
            return GitResult(
                success=False,
                message=f"仓库目录不存在: {repo_dir}"
            )
        
        git_dir = os.path.join(repo_dir, '.git')
        if not os.path.exists(git_dir):
            return GitResult(
                success=False,
                message=f"目录不是有效的 Git 仓库: {repo_dir}"
            )
        
        # 步骤1: 检查是否有未提交的修改
        # git status --porcelain 会返回所有修改的文件，如果没有修改则返回空
        status_result = _run_git_command(
            ['git', 'status', '--porcelain'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not status_result.success:
            return GitResult(
                success=False,
                message=f"检查仓库状态失败: {status_result.message}"
            )
        
        # 如果没有修改，检查与主分支差异后返回
        if not status_result.message.strip():
            logger.info("没有需要提交的修改")
            diff_message = _check_diff_with_default_branch(repo_dir, default_branch, timeout_cmd)
            return GitResult(
                success=True,
                message="没有需要提交的修改",
                diff_message=diff_message
            )
        
        logger.info(f"检测到未提交的修改:\n{status_result.message}")
        
        # 步骤2: 添加所有修改到暂存区
        add_result = _run_git_command(
            ['git', 'add', '-A'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not add_result.success:
            return GitResult(
                success=False,
                message=f"添加文件到暂存区失败: {add_result.message}"
            )
        logger.info("已添加所有修改到暂存区")
        
        # 步骤3: 提交修改
        commit_result = _run_git_command(
            ['git', 'commit', '-m', commit_msg],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not commit_result.success:
            return GitResult(
                success=False,
                message=f"提交失败: {commit_result.message}"
            )
        logger.info(f"已提交修改: {commit_msg}")
        
        # 步骤4: 获取当前分支名称
        branch_result = _run_git_command(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not branch_result.success:
            return GitResult(
                success=False,
                message=f"获取当前分支失败: {branch_result.message}"
            )
        current_branch = branch_result.message.strip()
        
        # 步骤5: 推送到云端
        push_result = _run_git_command(
            ['git', 'push', 'origin', current_branch],
            cwd=repo_dir,
            timeout=timeout_cmd
        )
        if not push_result.success:
            return GitResult(
                success=False,
                message=f"推送失败: {push_result.message}"
            )
        
        logger.info(f"已推送到云端: origin/{current_branch}")
        
        # 步骤6: 检查当前分支与主分支的差异
        diff_message = _check_diff_with_default_branch(repo_dir, default_branch, timeout_cmd)
        
        return GitResult(
            success=True,
            message=f"提交并推送成功: {current_branch}",
            diff_message=diff_message
        )
        
    except Exception as e:
        logger.error(f"commit_and_push_changes 异常: {e}", exc_info=True)
        return GitResult(
            success=False,
            message=f"操作异常: {str(e)}"
        )


# 使用示例
if __name__ == "__main__":
    import sys
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # 测试用例
    config = GitRepoConfig(
        url="https://github.com/example/repo.git",
        token="your_token_here",
        default_branch=""  # 留空测试自动获取
    )
    
    work_dir = "./test_repos"
    result = clone_or_sync_repo(work_dir, config)
    
    print(f"Success: {result.success}")
    print(f"Message: {result.message}")
    print(f"Default Branch: {result.default_branch}")
    
    sys.exit(0 if result.success else 1)
