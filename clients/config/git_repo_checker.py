#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Git 仓库检查器
"""

import logging
import subprocess

from .base_checker import BaseChecker
from utils.git_utils import detect_default_branch_from_url

logger = logging.getLogger(__name__)


class GitRepoChecker(BaseChecker):
    """Git 仓库访问检查器"""
    
    def check(self) -> bool:
        """
        检查单个 Git 仓库是否可访问
        如果仓库没有配置默认主分支，则自动获取并更新到 apiserver
        
        Args:
            repo: Git 仓库配置
            
        Returns:
            是否可访问
        """
        for repo in self.config.code_git:
            url = repo.get_auth_url()            
            try:
                result = subprocess.run(
                    ['git', 'ls-remote', '--exit-code', url],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                if result.returncode != 0:
                    self.add_error(f"Git 仓库无法访问: {repo.name} ({repo.url}), 错误: {result.stderr.strip()}")
                    return False
                logger.info(f"✓ Git 仓库可访问: {repo.name} ({repo.url})")
            except subprocess.TimeoutExpired:
                self.add_error(f"Git 仓库连接超时: {repo.name} ({repo.url})")
                return False
            except FileNotFoundError:
                self.add_error("Git 命令未找到，请确保已安装 Git")
                return False
            except Exception as e:
                self.add_error(f"Git 仓库检查异常: {repo.name} ({repo.url}), 错误: {e}")
                return False
        return True

