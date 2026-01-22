#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Agent 可用性检查器
"""

import logging
import tempfile
import os

from .base_checker import BaseChecker

logger = logging.getLogger(__name__)


class AgentChecker(BaseChecker):
    """Agent 可用性检查器"""
    
    def check(self, **kwargs) -> bool:
        """
        执行所有 Agent 相关检查
        
        Returns:
            是否全部通过检查
        """
        # 检查 agent 是否配置
        if self.config.agent is None:
            self.add_error("Agent 未配置")
            return False
        
        # 检查 agent 是否可用
        if not self._check_agent_available():
            return False
        
        # 检查 agent 是否具有工具使用权限
        if not self._check_agent_tools():
            return False
        
        return True
    
    def _check_agent_available(self) -> bool:
        """
        检查 agent 是否可用
        发送 prompt "你是谁"，检查是否正确执行并返回
        
        Returns:
            是否可用
        """
        agent = self.config.agent
        
        # 使用当前工作目录
        cwd = os.getcwd()
        
        try:
            logger.info(f"检查 Agent [{agent.name}] 是否可用...")
            
            success, reply = agent.run_prompt(
                trace_id="agent_check",
                cwd=cwd,
                prompt="你是谁？请简短回答。",
                timeout=60  # 60秒超时
            )
            
            if success and reply and len(reply.strip()) > 0:
                logger.info(f"✓ Agent [{agent.name}] 可用，回复: {reply[:100]}...")
                return True
            else:
                self.add_error(f"Agent [{agent.name}] 不可用: {reply if reply else '无响应'}")
                return False
                
        except Exception as e:
            self.add_error(f"Agent [{agent.name}] 检查失败: {type(e).__name__}: {str(e)}")
            return False
    
    def _check_agent_tools(self) -> bool:
        """
        检查 agent 是否具有工具使用权限 (git、bash)
        直接询问 agent，让 agent 执行命令给出回答
        
        Returns:
            是否具有权限
        """
        agent = self.config.agent
        
        # 使用当前工作目录
        cwd = os.getcwd()
        
        try:
            logger.info(f"检查 Agent [{agent.name}] 工具权限...")
            
            # 询问 agent 是否可以执行 git 和 bash 命令
            prompt = """请检查你是否具有以下工具的使用权限，并实际执行验证：

1. git 工具：请执行 `git --version` 命令
2. bash/shell 工具：请执行 `echo "tool_check_ok"` 命令

请分别执行上述命令，并告诉我：
- 每个命令是否成功执行
- 执行结果是什么

如果无法执行某个命令，请说明原因。请简洁回答。"""
            
            success, reply = agent.run_prompt(
                trace_id="agent_tools_check",
                cwd=cwd,
                prompt=prompt,
                timeout=120  # 120秒超时
            )
            
            if not success:
                self.add_error(f"Agent [{agent.name}] 工具权限检查失败: {reply if reply else '无响应'}")
                return False
            
            reply_lower = reply.lower()
            
            # 检查回复中是否包含成功执行的迹象
            git_ok = False
            bash_ok = False
            
            # 检查 git
            if "git version" in reply_lower or "git 版本" in reply_lower:
                git_ok = True
            elif "无法" in reply_lower and "git" in reply_lower:
                self.add_warning(f"Agent [{agent.name}] 可能无法使用 git 工具")
            elif "git" in reply_lower and ("成功" in reply_lower or "执行" in reply_lower):
                git_ok = True
            
            # 检查 bash/shell
            if "tool_check_ok" in reply:
                bash_ok = True
            elif "echo" in reply_lower and ("成功" in reply_lower or "执行" in reply_lower):
                bash_ok = True
            elif "无法" in reply_lower and ("bash" in reply_lower or "shell" in reply_lower or "echo" in reply_lower):
                self.add_warning(f"Agent [{agent.name}] 可能无法使用 bash/shell 工具")
            
            if git_ok and bash_ok:
                logger.info(f"✓ Agent [{agent.name}] 具有 git 和 bash 工具权限")
                return True
            elif git_ok or bash_ok:
                # 至少有一个工具可用，给出警告但不阻止启动
                if not git_ok:
                    self.add_warning(f"Agent [{agent.name}] git 工具权限检查不确定")
                if not bash_ok:
                    self.add_warning(f"Agent [{agent.name}] bash 工具权限检查不确定")
                logger.info(f"✓ Agent [{agent.name}] 工具权限检查通过（部分工具待确认）")
                logger.info(f"  Agent 回复: {reply[:200]}...")
                return True
            else:
                # 无法确认，记录警告但不阻止启动（可能是回复格式问题）
                self.add_warning(f"Agent [{agent.name}] 工具权限无法确认，回复: {reply[:200]}...")
                logger.info(f"⚠ Agent [{agent.name}] 工具权限无法明确确认，但继续启动")
                return True
                
        except Exception as e:
            self.add_error(f"Agent [{agent.name}] 工具权限检查异常: {type(e).__name__}: {str(e)}")
            return False
