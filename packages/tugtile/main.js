'use strict';
const Sortable = (function () {
  var module = { exports: {} }; var exports = module.exports;
/*! Sortable 1.15.6 - MIT | git://github.com/SortableJS/Sortable.git */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t=t||self).Sortable=e()}(this,function(){"use strict";function e(e,t){var n,o=Object.keys(e);return Object.getOwnPropertySymbols&&(n=Object.getOwnPropertySymbols(e),t&&(n=n.filter(function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable})),o.push.apply(o,n)),o}function I(o){for(var t=1;t<arguments.length;t++){var i=null!=arguments[t]?arguments[t]:{};t%2?e(Object(i),!0).forEach(function(t){var e,n;e=o,t=i[n=t],n in e?Object.defineProperty(e,n,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[n]=t}):Object.getOwnPropertyDescriptors?Object.defineProperties(o,Object.getOwnPropertyDescriptors(i)):e(Object(i)).forEach(function(t){Object.defineProperty(o,t,Object.getOwnPropertyDescriptor(i,t))})}return o}function o(t){return(o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t})(t)}function a(){return(a=Object.assign||function(t){for(var e=1;e<arguments.length;e++){var n,o=arguments[e];for(n in o)Object.prototype.hasOwnProperty.call(o,n)&&(t[n]=o[n])}return t}).apply(this,arguments)}function i(t,e){if(null==t)return{};var n,o=function(t,e){if(null==t)return{};for(var n,o={},i=Object.keys(t),r=0;r<i.length;r++)n=i[r],0<=e.indexOf(n)||(o[n]=t[n]);return o}(t,e);if(Object.getOwnPropertySymbols)for(var i=Object.getOwnPropertySymbols(t),r=0;r<i.length;r++)n=i[r],0<=e.indexOf(n)||Object.prototype.propertyIsEnumerable.call(t,n)&&(o[n]=t[n]);return o}function r(t){return function(t){if(Array.isArray(t))return l(t)}(t)||function(t){if("undefined"!=typeof Symbol&&null!=t[Symbol.iterator]||null!=t["@@iterator"])return Array.from(t)}(t)||function(t,e){if(t){if("string"==typeof t)return l(t,e);var n=Object.prototype.toString.call(t).slice(8,-1);return"Map"===(n="Object"===n&&t.constructor?t.constructor.name:n)||"Set"===n?Array.from(t):"Arguments"===n||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?l(t,e):void 0}}(t)||function(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function l(t,e){(null==e||e>t.length)&&(e=t.length);for(var n=0,o=new Array(e);n<e;n++)o[n]=t[n];return o}function t(t){if("undefined"!=typeof window&&window.navigator)return!!navigator.userAgent.match(t)}var y=t(/(?:Trident.*rv[ :]?11\.|msie|iemobile|Windows Phone)/i),w=t(/Edge/i),s=t(/firefox/i),u=t(/safari/i)&&!t(/chrome/i)&&!t(/android/i),c=t(/iP(ad|od|hone)/i),n=t(/chrome/i)&&t(/android/i),d={capture:!1,passive:!1};function h(t,e,n){t.addEventListener(e,n,!y&&d)}function p(t,e,n){t.removeEventListener(e,n,!y&&d)}function f(t,e){if(e&&(">"===e[0]&&(e=e.substring(1)),t))try{if(t.matches)return t.matches(e);if(t.msMatchesSelector)return t.msMatchesSelector(e);if(t.webkitMatchesSelector)return t.webkitMatchesSelector(e)}catch(t){return}}function g(t){return t.host&&t!==document&&t.host.nodeType?t.host:t.parentNode}function P(t,e,n,o){if(t){n=n||document;do{if(null!=e&&(">"!==e[0]||t.parentNode===n)&&f(t,e)||o&&t===n)return t}while(t!==n&&(t=g(t)))}return null}var m,v=/\s+/g;function k(t,e,n){var o;t&&e&&(t.classList?t.classList[n?"add":"remove"](e):(o=(" "+t.className+" ").replace(v," ").replace(" "+e+" "," "),t.className=(o+(n?" "+e:"")).replace(v," ")))}function R(t,e,n){var o=t&&t.style;if(o){if(void 0===n)return document.defaultView&&document.defaultView.getComputedStyle?n=document.defaultView.getComputedStyle(t,""):t.currentStyle&&(n=t.currentStyle),void 0===e?n:n[e];o[e=!(e in o||-1!==e.indexOf("webkit"))?"-webkit-"+e:e]=n+("string"==typeof n?"":"px")}}function b(t,e){var n="";if("string"==typeof t)n=t;else do{var o=R(t,"transform")}while(o&&"none"!==o&&(n=o+" "+n),!e&&(t=t.parentNode));var i=window.DOMMatrix||window.WebKitCSSMatrix||window.CSSMatrix||window.MSCSSMatrix;return i&&new i(n)}function D(t,e,n){if(t){var o=t.getElementsByTagName(e),i=0,r=o.length;if(n)for(;i<r;i++)n(o[i],i);return o}return[]}function O(){var t=document.scrollingElement;return t||document.documentElement}function X(t,e,n,o,i){if(t.getBoundingClientRect||t===window){var r,a,l,s,c,u,d=t!==window&&t.parentNode&&t!==O()?(a=(r=t.getBoundingClientRect()).top,l=r.left,s=r.bottom,c=r.right,u=r.height,r.width):(l=a=0,s=window.innerHeight,c=window.innerWidth,u=window.innerHeight,window.innerWidth);if((e||n)&&t!==window&&(i=i||t.parentNode,!y))do{if(i&&i.getBoundingClientRect&&("none"!==R(i,"transform")||n&&"static"!==R(i,"position"))){var h=i.getBoundingClientRect();a-=h.top+parseInt(R(i,"border-top-width")),l-=h.left+parseInt(R(i,"border-left-width")),s=a+r.height,c=l+r.width;break}}while(i=i.parentNode);return o&&t!==window&&(o=(e=b(i||t))&&e.a,t=e&&e.d,e&&(s=(a/=t)+(u/=t),c=(l/=o)+(d/=o))),{top:a,left:l,bottom:s,right:c,width:d,height:u}}}function Y(t,e,n){for(var o=M(t,!0),i=X(t)[e];o;){var r=X(o)[n];if(!("top"===n||"left"===n?r<=i:i<=r))return o;if(o===O())break;o=M(o,!1)}return!1}function B(t,e,n,o){for(var i=0,r=0,a=t.children;r<a.length;){if("none"!==a[r].style.display&&a[r]!==jt.ghost&&(o||a[r]!==jt.dragged)&&P(a[r],n.draggable,t,!1)){if(i===e)return a[r];i++}r++}return null}function F(t,e){for(var n=t.lastElementChild;n&&(n===jt.ghost||"none"===R(n,"display")||e&&!f(n,e));)n=n.previousElementSibling;return n||null}function j(t,e){var n=0;if(!t||!t.parentNode)return-1;for(;t=t.previousElementSibling;)"TEMPLATE"===t.nodeName.toUpperCase()||t===jt.clone||e&&!f(t,e)||n++;return n}function E(t){var e=0,n=0,o=O();if(t)do{var i=b(t),r=i.a,i=i.d}while(e+=t.scrollLeft*r,n+=t.scrollTop*i,t!==o&&(t=t.parentNode));return[e,n]}function M(t,e){if(!t||!t.getBoundingClientRect)return O();var n=t,o=!1;do{if(n.clientWidth<n.scrollWidth||n.clientHeight<n.scrollHeight){var i=R(n);if(n.clientWidth<n.scrollWidth&&("auto"==i.overflowX||"scroll"==i.overflowX)||n.clientHeight<n.scrollHeight&&("auto"==i.overflowY||"scroll"==i.overflowY)){if(!n.getBoundingClientRect||n===document.body)return O();if(o||e)return n;o=!0}}}while(n=n.parentNode);return O()}function S(t,e){return Math.round(t.top)===Math.round(e.top)&&Math.round(t.left)===Math.round(e.left)&&Math.round(t.height)===Math.round(e.height)&&Math.round(t.width)===Math.round(e.width)}function _(e,n){return function(){var t;m||(1===(t=arguments).length?e.call(this,t[0]):e.apply(this,t),m=setTimeout(function(){m=void 0},n))}}function H(t,e,n){t.scrollLeft+=e,t.scrollTop+=n}function C(t){var e=window.Polymer,n=window.jQuery||window.Zepto;return e&&e.dom?e.dom(t).cloneNode(!0):n?n(t).clone(!0)[0]:t.cloneNode(!0)}function T(t,e){R(t,"position","absolute"),R(t,"top",e.top),R(t,"left",e.left),R(t,"width",e.width),R(t,"height",e.height)}function x(t){R(t,"position",""),R(t,"top",""),R(t,"left",""),R(t,"width",""),R(t,"height","")}function L(n,o,i){var r={};return Array.from(n.children).forEach(function(t){var e;P(t,o.draggable,n,!1)&&!t.animated&&t!==i&&(e=X(t),r.left=Math.min(null!==(t=r.left)&&void 0!==t?t:1/0,e.left),r.top=Math.min(null!==(t=r.top)&&void 0!==t?t:1/0,e.top),r.right=Math.max(null!==(t=r.right)&&void 0!==t?t:-1/0,e.right),r.bottom=Math.max(null!==(t=r.bottom)&&void 0!==t?t:-1/0,e.bottom))}),r.width=r.right-r.left,r.height=r.bottom-r.top,r.x=r.left,r.y=r.top,r}var K="Sortable"+(new Date).getTime();function A(){var e,o=[];return{captureAnimationState:function(){o=[],this.options.animation&&[].slice.call(this.el.children).forEach(function(t){var e,n;"none"!==R(t,"display")&&t!==jt.ghost&&(o.push({target:t,rect:X(t)}),e=I({},o[o.length-1].rect),!t.thisAnimationDuration||(n=b(t,!0))&&(e.top-=n.f,e.left-=n.e),t.fromRect=e)})},addAnimationState:function(t){o.push(t)},removeAnimationState:function(t){o.splice(function(t,e){for(var n in t)if(t.hasOwnProperty(n))for(var o in e)if(e.hasOwnProperty(o)&&e[o]===t[n][o])return Number(n);return-1}(o,{target:t}),1)},animateAll:function(t){var c=this;if(!this.options.animation)return clearTimeout(e),void("function"==typeof t&&t());var u=!1,d=0;o.forEach(function(t){var e=0,n=t.target,o=n.fromRect,i=X(n),r=n.prevFromRect,a=n.prevToRect,l=t.rect,s=b(n,!0);s&&(i.top-=s.f,i.left-=s.e),n.toRect=i,n.thisAnimationDuration&&S(r,i)&&!S(o,i)&&(l.top-i.top)/(l.left-i.left)==(o.top-i.top)/(o.left-i.left)&&(t=l,s=r,r=a,a=c.options,e=Math.sqrt(Math.pow(s.top-t.top,2)+Math.pow(s.left-t.left,2))/Math.sqrt(Math.pow(s.top-r.top,2)+Math.pow(s.left-r.left,2))*a.animation),S(i,o)||(n.prevFromRect=o,n.prevToRect=i,e=e||c.options.animation,c.animate(n,l,i,e)),e&&(u=!0,d=Math.max(d,e),clearTimeout(n.animationResetTimer),n.animationResetTimer=setTimeout(function(){n.animationTime=0,n.prevFromRect=null,n.fromRect=null,n.prevToRect=null,n.thisAnimationDuration=null},e),n.thisAnimationDuration=e)}),clearTimeout(e),u?e=setTimeout(function(){"function"==typeof t&&t()},d):"function"==typeof t&&t(),o=[]},animate:function(t,e,n,o){var i,r;o&&(R(t,"transition",""),R(t,"transform",""),i=(r=b(this.el))&&r.a,r=r&&r.d,i=(e.left-n.left)/(i||1),r=(e.top-n.top)/(r||1),t.animatingX=!!i,t.animatingY=!!r,R(t,"transform","translate3d("+i+"px,"+r+"px,0)"),this.forRepaintDummy=t.offsetWidth,R(t,"transition","transform "+o+"ms"+(this.options.easing?" "+this.options.easing:"")),R(t,"transform","translate3d(0,0,0)"),"number"==typeof t.animated&&clearTimeout(t.animated),t.animated=setTimeout(function(){R(t,"transition",""),R(t,"transform",""),t.animated=!1,t.animatingX=!1,t.animatingY=!1},o))}}}var N=[],W={initializeByDefault:!0},z={mount:function(e){for(var t in W)!W.hasOwnProperty(t)||t in e||(e[t]=W[t]);N.forEach(function(t){if(t.pluginName===e.pluginName)throw"Sortable: Cannot mount plugin ".concat(e.pluginName," more than once")}),N.push(e)},pluginEvent:function(e,n,o){var t=this;this.eventCanceled=!1,o.cancel=function(){t.eventCanceled=!0};var i=e+"Global";N.forEach(function(t){n[t.pluginName]&&(n[t.pluginName][i]&&n[t.pluginName][i](I({sortable:n},o)),n.options[t.pluginName]&&n[t.pluginName][e]&&n[t.pluginName][e](I({sortable:n},o)))})},initializePlugins:function(n,o,i,t){for(var e in N.forEach(function(t){var e=t.pluginName;(n.options[e]||t.initializeByDefault)&&((t=new t(n,o,n.options)).sortable=n,t.options=n.options,n[e]=t,a(i,t.defaults))}),n.options){var r;n.options.hasOwnProperty(e)&&(void 0!==(r=this.modifyOption(n,e,n.options[e]))&&(n.options[e]=r))}},getEventProperties:function(e,n){var o={};return N.forEach(function(t){"function"==typeof t.eventProperties&&a(o,t.eventProperties.call(n[t.pluginName],e))}),o},modifyOption:function(e,n,o){var i;return N.forEach(function(t){e[t.pluginName]&&t.optionListeners&&"function"==typeof t.optionListeners[n]&&(i=t.optionListeners[n].call(e[t.pluginName],o))}),i}};function G(t){var e=t.sortable,n=t.rootEl,o=t.name,i=t.targetEl,r=t.cloneEl,a=t.toEl,l=t.fromEl,s=t.oldIndex,c=t.newIndex,u=t.oldDraggableIndex,d=t.newDraggableIndex,h=t.originalEvent,p=t.putSortable,f=t.extraEventProperties;if(e=e||n&&n[K]){var g,m=e.options,t="on"+o.charAt(0).toUpperCase()+o.substr(1);!window.CustomEvent||y||w?(g=document.createEvent("Event")).initEvent(o,!0,!0):g=new CustomEvent(o,{bubbles:!0,cancelable:!0}),g.to=a||n,g.from=l||n,g.item=i||n,g.clone=r,g.oldIndex=s,g.newIndex=c,g.oldDraggableIndex=u,g.newDraggableIndex=d,g.originalEvent=h,g.pullMode=p?p.lastPutMode:void 0;var v,b=I(I({},f),z.getEventProperties(o,e));for(v in b)g[v]=b[v];n&&n.dispatchEvent(g),m[t]&&m[t].call(e,g)}}function U(t,e){var n=(o=2<arguments.length&&void 0!==arguments[2]?arguments[2]:{}).evt,o=i(o,q);z.pluginEvent.bind(jt)(t,e,I({dragEl:Z,parentEl:$,ghostEl:Q,rootEl:J,nextEl:tt,lastDownEl:et,cloneEl:nt,cloneHidden:ot,dragStarted:mt,putSortable:ct,activeSortable:jt.active,originalEvent:n,oldIndex:it,oldDraggableIndex:at,newIndex:rt,newDraggableIndex:lt,hideGhostForTarget:Xt,unhideGhostForTarget:Yt,cloneNowHidden:function(){ot=!0},cloneNowShown:function(){ot=!1},dispatchSortableEvent:function(t){V({sortable:e,name:t,originalEvent:n})}},o))}var q=["evt"];function V(t){G(I({putSortable:ct,cloneEl:nt,targetEl:Z,rootEl:J,oldIndex:it,oldDraggableIndex:at,newIndex:rt,newDraggableIndex:lt},t))}var Z,$,Q,J,tt,et,nt,ot,it,rt,at,lt,st,ct,ut,dt,ht,pt,ft,gt,mt,vt,bt,yt,wt,Dt=!1,Et=!1,St=[],_t=!1,Ct=!1,Tt=[],xt=!1,Ot=[],Mt="undefined"!=typeof document,At=c,Nt=w||y?"cssFloat":"float",It=Mt&&!n&&!c&&"draggable"in document.createElement("div"),Pt=function(){if(Mt){if(y)return!1;var t=document.createElement("x");return t.style.cssText="pointer-events:auto","auto"===t.style.pointerEvents}}(),kt=function(t,e){var n=R(t),o=parseInt(n.width)-parseInt(n.paddingLeft)-parseInt(n.paddingRight)-parseInt(n.borderLeftWidth)-parseInt(n.borderRightWidth),i=B(t,0,e),r=B(t,1,e),a=i&&R(i),l=r&&R(r),s=a&&parseInt(a.marginLeft)+parseInt(a.marginRight)+X(i).width,t=l&&parseInt(l.marginLeft)+parseInt(l.marginRight)+X(r).width;if("flex"===n.display)return"column"===n.flexDirection||"column-reverse"===n.flexDirection?"vertical":"horizontal";if("grid"===n.display)return n.gridTemplateColumns.split(" ").length<=1?"vertical":"horizontal";if(i&&a.float&&"none"!==a.float){e="left"===a.float?"left":"right";return!r||"both"!==l.clear&&l.clear!==e?"horizontal":"vertical"}return i&&("block"===a.display||"flex"===a.display||"table"===a.display||"grid"===a.display||o<=s&&"none"===n[Nt]||r&&"none"===n[Nt]&&o<s+t)?"vertical":"horizontal"},Rt=function(t){function l(r,a){return function(t,e,n,o){var i=t.options.group.name&&e.options.group.name&&t.options.group.name===e.options.group.name;if(null==r&&(a||i))return!0;if(null==r||!1===r)return!1;if(a&&"clone"===r)return r;if("function"==typeof r)return l(r(t,e,n,o),a)(t,e,n,o);e=(a?t:e).options.group.name;return!0===r||"string"==typeof r&&r===e||r.join&&-1<r.indexOf(e)}}var e={},n=t.group;n&&"object"==o(n)||(n={name:n}),e.name=n.name,e.checkPull=l(n.pull,!0),e.checkPut=l(n.put),e.revertClone=n.revertClone,t.group=e},Xt=function(){!Pt&&Q&&R(Q,"display","none")},Yt=function(){!Pt&&Q&&R(Q,"display","")};Mt&&!n&&document.addEventListener("click",function(t){if(Et)return t.preventDefault(),t.stopPropagation&&t.stopPropagation(),t.stopImmediatePropagation&&t.stopImmediatePropagation(),Et=!1},!0);function Bt(t){if(Z){t=t.touches?t.touches[0]:t;var e=(i=t.clientX,r=t.clientY,St.some(function(t){var e=t[K].options.emptyInsertThreshold;if(e&&!F(t)){var n=X(t),o=i>=n.left-e&&i<=n.right+e,e=r>=n.top-e&&r<=n.bottom+e;return o&&e?a=t:void 0}}),a);if(e){var n,o={};for(n in t)t.hasOwnProperty(n)&&(o[n]=t[n]);o.target=o.rootEl=e,o.preventDefault=void 0,o.stopPropagation=void 0,e[K]._onDragOver(o)}}var i,r,a}function Ft(t){Z&&Z.parentNode[K]._isOutsideThisEl(t.target)}function jt(t,e){if(!t||!t.nodeType||1!==t.nodeType)throw"Sortable: `el` must be an HTMLElement, not ".concat({}.toString.call(t));this.el=t,this.options=e=a({},e),t[K]=this;var n,o,i={group:null,sort:!0,disabled:!1,store:null,handle:null,draggable:/^[uo]l$/i.test(t.nodeName)?">li":">*",swapThreshold:1,invertSwap:!1,invertedSwapThreshold:null,removeCloneOnHide:!0,direction:function(){return kt(t,this.options)},ghostClass:"sortable-ghost",chosenClass:"sortable-chosen",dragClass:"sortable-drag",ignore:"a, img",filter:null,preventOnFilter:!0,animation:0,easing:null,setData:function(t,e){t.setData("Text",e.textContent)},dropBubble:!1,dragoverBubble:!1,dataIdAttr:"data-id",delay:0,delayOnTouchOnly:!1,touchStartThreshold:(Number.parseInt?Number:window).parseInt(window.devicePixelRatio,10)||1,forceFallback:!1,fallbackClass:"sortable-fallback",fallbackOnBody:!1,fallbackTolerance:0,fallbackOffset:{x:0,y:0},supportPointer:!1!==jt.supportPointer&&"PointerEvent"in window&&(!u||c),emptyInsertThreshold:5};for(n in z.initializePlugins(this,t,i),i)n in e||(e[n]=i[n]);for(o in Rt(e),this)"_"===o.charAt(0)&&"function"==typeof this[o]&&(this[o]=this[o].bind(this));this.nativeDraggable=!e.forceFallback&&It,this.nativeDraggable&&(this.options.touchStartThreshold=1),e.supportPointer?h(t,"pointerdown",this._onTapStart):(h(t,"mousedown",this._onTapStart),h(t,"touchstart",this._onTapStart)),this.nativeDraggable&&(h(t,"dragover",this),h(t,"dragenter",this)),St.push(this.el),e.store&&e.store.get&&this.sort(e.store.get(this)||[]),a(this,A())}function Ht(t,e,n,o,i,r,a,l){var s,c,u=t[K],d=u.options.onMove;return!window.CustomEvent||y||w?(s=document.createEvent("Event")).initEvent("move",!0,!0):s=new CustomEvent("move",{bubbles:!0,cancelable:!0}),s.to=e,s.from=t,s.dragged=n,s.draggedRect=o,s.related=i||e,s.relatedRect=r||X(e),s.willInsertAfter=l,s.originalEvent=a,t.dispatchEvent(s),c=d?d.call(u,s,a):c}function Lt(t){t.draggable=!1}function Kt(){xt=!1}function Wt(t){return setTimeout(t,0)}function zt(t){return clearTimeout(t)}jt.prototype={constructor:jt,_isOutsideThisEl:function(t){this.el.contains(t)||t===this.el||(vt=null)},_getDirection:function(t,e){return"function"==typeof this.options.direction?this.options.direction.call(this,t,e,Z):this.options.direction},_onTapStart:function(e){if(e.cancelable){var n=this,o=this.el,t=this.options,i=t.preventOnFilter,r=e.type,a=e.touches&&e.touches[0]||e.pointerType&&"touch"===e.pointerType&&e,l=(a||e).target,s=e.target.shadowRoot&&(e.path&&e.path[0]||e.composedPath&&e.composedPath()[0])||l,c=t.filter;if(!function(t){Ot.length=0;var e=t.getElementsByTagName("input"),n=e.length;for(;n--;){var o=e[n];o.checked&&Ot.push(o)}}(o),!Z&&!(/mousedown|pointerdown/.test(r)&&0!==e.button||t.disabled)&&!s.isContentEditable&&(this.nativeDraggable||!u||!l||"SELECT"!==l.tagName.toUpperCase())&&!((l=P(l,t.draggable,o,!1))&&l.animated||et===l)){if(it=j(l),at=j(l,t.draggable),"function"==typeof c){if(c.call(this,e,l,this))return V({sortable:n,rootEl:s,name:"filter",targetEl:l,toEl:o,fromEl:o}),U("filter",n,{evt:e}),void(i&&e.preventDefault())}else if(c=c&&c.split(",").some(function(t){if(t=P(s,t.trim(),o,!1))return V({sortable:n,rootEl:t,name:"filter",targetEl:l,fromEl:o,toEl:o}),U("filter",n,{evt:e}),!0}))return void(i&&e.preventDefault());t.handle&&!P(s,t.handle,o,!1)||this._prepareDragStart(e,a,l)}}},_prepareDragStart:function(t,e,n){var o,i=this,r=i.el,a=i.options,l=r.ownerDocument;n&&!Z&&n.parentNode===r&&(o=X(n),J=r,$=(Z=n).parentNode,tt=Z.nextSibling,et=n,st=a.group,ut={target:jt.dragged=Z,clientX:(e||t).clientX,clientY:(e||t).clientY},ft=ut.clientX-o.left,gt=ut.clientY-o.top,this._lastX=(e||t).clientX,this._lastY=(e||t).clientY,Z.style["will-change"]="all",o=function(){U("delayEnded",i,{evt:t}),jt.eventCanceled?i._onDrop():(i._disableDelayedDragEvents(),!s&&i.nativeDraggable&&(Z.draggable=!0),i._triggerDragStart(t,e),V({sortable:i,name:"choose",originalEvent:t}),k(Z,a.chosenClass,!0))},a.ignore.split(",").forEach(function(t){D(Z,t.trim(),Lt)}),h(l,"dragover",Bt),h(l,"mousemove",Bt),h(l,"touchmove",Bt),a.supportPointer?(h(l,"pointerup",i._onDrop),this.nativeDraggable||h(l,"pointercancel",i._onDrop)):(h(l,"mouseup",i._onDrop),h(l,"touchend",i._onDrop),h(l,"touchcancel",i._onDrop)),s&&this.nativeDraggable&&(this.options.touchStartThreshold=4,Z.draggable=!0),U("delayStart",this,{evt:t}),!a.delay||a.delayOnTouchOnly&&!e||this.nativeDraggable&&(w||y)?o():jt.eventCanceled?this._onDrop():(a.supportPointer?(h(l,"pointerup",i._disableDelayedDrag),h(l,"pointercancel",i._disableDelayedDrag)):(h(l,"mouseup",i._disableDelayedDrag),h(l,"touchend",i._disableDelayedDrag),h(l,"touchcancel",i._disableDelayedDrag)),h(l,"mousemove",i._delayedDragTouchMoveHandler),h(l,"touchmove",i._delayedDragTouchMoveHandler),a.supportPointer&&h(l,"pointermove",i._delayedDragTouchMoveHandler),i._dragStartTimer=setTimeout(o,a.delay)))},_delayedDragTouchMoveHandler:function(t){t=t.touches?t.touches[0]:t;Math.max(Math.abs(t.clientX-this._lastX),Math.abs(t.clientY-this._lastY))>=Math.floor(this.options.touchStartThreshold/(this.nativeDraggable&&window.devicePixelRatio||1))&&this._disableDelayedDrag()},_disableDelayedDrag:function(){Z&&Lt(Z),clearTimeout(this._dragStartTimer),this._disableDelayedDragEvents()},_disableDelayedDragEvents:function(){var t=this.el.ownerDocument;p(t,"mouseup",this._disableDelayedDrag),p(t,"touchend",this._disableDelayedDrag),p(t,"touchcancel",this._disableDelayedDrag),p(t,"pointerup",this._disableDelayedDrag),p(t,"pointercancel",this._disableDelayedDrag),p(t,"mousemove",this._delayedDragTouchMoveHandler),p(t,"touchmove",this._delayedDragTouchMoveHandler),p(t,"pointermove",this._delayedDragTouchMoveHandler)},_triggerDragStart:function(t,e){e=e||"touch"==t.pointerType&&t,!this.nativeDraggable||e?this.options.supportPointer?h(document,"pointermove",this._onTouchMove):h(document,e?"touchmove":"mousemove",this._onTouchMove):(h(Z,"dragend",this),h(J,"dragstart",this._onDragStart));try{document.selection?Wt(function(){document.selection.empty()}):window.getSelection().removeAllRanges()}catch(t){}},_dragStarted:function(t,e){var n;Dt=!1,J&&Z?(U("dragStarted",this,{evt:e}),this.nativeDraggable&&h(document,"dragover",Ft),n=this.options,t||k(Z,n.dragClass,!1),k(Z,n.ghostClass,!0),jt.active=this,t&&this._appendGhost(),V({sortable:this,name:"start",originalEvent:e})):this._nulling()},_emulateDragOver:function(){if(dt){this._lastX=dt.clientX,this._lastY=dt.clientY,Xt();for(var t=document.elementFromPoint(dt.clientX,dt.clientY),e=t;t&&t.shadowRoot&&(t=t.shadowRoot.elementFromPoint(dt.clientX,dt.clientY))!==e;)e=t;if(Z.parentNode[K]._isOutsideThisEl(t),e)do{if(e[K])if(e[K]._onDragOver({clientX:dt.clientX,clientY:dt.clientY,target:t,rootEl:e})&&!this.options.dragoverBubble)break}while(e=g(t=e));Yt()}},_onTouchMove:function(t){if(ut){var e=this.options,n=e.fallbackTolerance,o=e.fallbackOffset,i=t.touches?t.touches[0]:t,r=Q&&b(Q,!0),a=Q&&r&&r.a,l=Q&&r&&r.d,e=At&&wt&&E(wt),a=(i.clientX-ut.clientX+o.x)/(a||1)+(e?e[0]-Tt[0]:0)/(a||1),l=(i.clientY-ut.clientY+o.y)/(l||1)+(e?e[1]-Tt[1]:0)/(l||1);if(!jt.active&&!Dt){if(n&&Math.max(Math.abs(i.clientX-this._lastX),Math.abs(i.clientY-this._lastY))<n)return;this._onDragStart(t,!0)}Q&&(r?(r.e+=a-(ht||0),r.f+=l-(pt||0)):r={a:1,b:0,c:0,d:1,e:a,f:l},r="matrix(".concat(r.a,",").concat(r.b,",").concat(r.c,",").concat(r.d,",").concat(r.e,",").concat(r.f,")"),R(Q,"webkitTransform",r),R(Q,"mozTransform",r),R(Q,"msTransform",r),R(Q,"transform",r),ht=a,pt=l,dt=i),t.cancelable&&t.preventDefault()}},_appendGhost:function(){if(!Q){var t=this.options.fallbackOnBody?document.body:J,e=X(Z,!0,At,!0,t),n=this.options;if(At){for(wt=t;"static"===R(wt,"position")&&"none"===R(wt,"transform")&&wt!==document;)wt=wt.parentNode;wt!==document.body&&wt!==document.documentElement?(wt===document&&(wt=O()),e.top+=wt.scrollTop,e.left+=wt.scrollLeft):wt=O(),Tt=E(wt)}k(Q=Z.cloneNode(!0),n.ghostClass,!1),k(Q,n.fallbackClass,!0),k(Q,n.dragClass,!0),R(Q,"transition",""),R(Q,"transform",""),R(Q,"box-sizing","border-box"),R(Q,"margin",0),R(Q,"top",e.top),R(Q,"left",e.left),R(Q,"width",e.width),R(Q,"height",e.height),R(Q,"opacity","0.8"),R(Q,"position",At?"absolute":"fixed"),R(Q,"zIndex","100000"),R(Q,"pointerEvents","none"),jt.ghost=Q,t.appendChild(Q),R(Q,"transform-origin",ft/parseInt(Q.style.width)*100+"% "+gt/parseInt(Q.style.height)*100+"%")}},_onDragStart:function(t,e){var n=this,o=t.dataTransfer,i=n.options;U("dragStart",this,{evt:t}),jt.eventCanceled?this._onDrop():(U("setupClone",this),jt.eventCanceled||((nt=C(Z)).removeAttribute("id"),nt.draggable=!1,nt.style["will-change"]="",this._hideClone(),k(nt,this.options.chosenClass,!1),jt.clone=nt),n.cloneId=Wt(function(){U("clone",n),jt.eventCanceled||(n.options.removeCloneOnHide||J.insertBefore(nt,Z),n._hideClone(),V({sortable:n,name:"clone"}))}),e||k(Z,i.dragClass,!0),e?(Et=!0,n._loopId=setInterval(n._emulateDragOver,50)):(p(document,"mouseup",n._onDrop),p(document,"touchend",n._onDrop),p(document,"touchcancel",n._onDrop),o&&(o.effectAllowed="move",i.setData&&i.setData.call(n,o,Z)),h(document,"drop",n),R(Z,"transform","translateZ(0)")),Dt=!0,n._dragStartId=Wt(n._dragStarted.bind(n,e,t)),h(document,"selectstart",n),mt=!0,window.getSelection().removeAllRanges(),u&&R(document.body,"user-select","none"))},_onDragOver:function(n){var o,i,r,t,e,a=this.el,l=n.target,s=this.options,c=s.group,u=jt.active,d=st===c,h=s.sort,p=ct||u,f=this,g=!1;if(!xt){if(void 0!==n.preventDefault&&n.cancelable&&n.preventDefault(),l=P(l,s.draggable,a,!0),O("dragOver"),jt.eventCanceled)return g;if(Z.contains(n.target)||l.animated&&l.animatingX&&l.animatingY||f._ignoreWhileAnimating===l)return A(!1);if(Et=!1,u&&!s.disabled&&(d?h||(i=$!==J):ct===this||(this.lastPutMode=st.checkPull(this,u,Z,n))&&c.checkPut(this,u,Z,n))){if(r="vertical"===this._getDirection(n,l),o=X(Z),O("dragOverValid"),jt.eventCanceled)return g;if(i)return $=J,M(),this._hideClone(),O("revert"),jt.eventCanceled||(tt?J.insertBefore(Z,tt):J.appendChild(Z)),A(!0);var m=F(a,s.draggable);if(m&&(S=n,c=r,x=X(F((E=this).el,E.options.draggable)),E=L(E.el,E.options,Q),!(c?S.clientX>E.right+10||S.clientY>x.bottom&&S.clientX>x.left:S.clientY>E.bottom+10||S.clientX>x.right&&S.clientY>x.top)||m.animated)){if(m&&(t=n,e=r,C=X(B((_=this).el,0,_.options,!0)),_=L(_.el,_.options,Q),e?t.clientX<_.left-10||t.clientY<C.top&&t.clientX<C.right:t.clientY<_.top-10||t.clientY<C.bottom&&t.clientX<C.left)){var v=B(a,0,s,!0);if(v===Z)return A(!1);if(D=X(l=v),!1!==Ht(J,a,Z,o,l,D,n,!1))return M(),a.insertBefore(Z,v),$=a,N(),A(!0)}else if(l.parentNode===a){var b,y,w,D=X(l),E=Z.parentNode!==a,S=(S=Z.animated&&Z.toRect||o,x=l.animated&&l.toRect||D,_=(e=r)?S.left:S.top,t=e?S.right:S.bottom,C=e?S.width:S.height,v=e?x.left:x.top,S=e?x.right:x.bottom,x=e?x.width:x.height,!(_===v||t===S||_+C/2===v+x/2)),_=r?"top":"left",C=Y(l,"top","top")||Y(Z,"top","top"),v=C?C.scrollTop:void 0;if(vt!==l&&(y=D[_],_t=!1,Ct=!S&&s.invertSwap||E),0!==(b=function(t,e,n,o,i,r,a,l){var s=o?t.clientY:t.clientX,c=o?n.height:n.width,t=o?n.top:n.left,o=o?n.bottom:n.right,n=!1;if(!a)if(l&&yt<c*i){if(_t=!_t&&(1===bt?t+c*r/2<s:s<o-c*r/2)?!0:_t)n=!0;else if(1===bt?s<t+yt:o-yt<s)return-bt}else if(t+c*(1-i)/2<s&&s<o-c*(1-i)/2)return function(t){return j(Z)<j(t)?1:-1}(e);if((n=n||a)&&(s<t+c*r/2||o-c*r/2<s))return t+c/2<s?1:-1;return 0}(n,l,D,r,S?1:s.swapThreshold,null==s.invertedSwapThreshold?s.swapThreshold:s.invertedSwapThreshold,Ct,vt===l)))for(var T=j(Z);(w=$.children[T-=b])&&("none"===R(w,"display")||w===Q););if(0===b||w===l)return A(!1);bt=b;var x=(vt=l).nextElementSibling,E=!1,S=Ht(J,a,Z,o,l,D,n,E=1===b);if(!1!==S)return 1!==S&&-1!==S||(E=1===S),xt=!0,setTimeout(Kt,30),M(),E&&!x?a.appendChild(Z):l.parentNode.insertBefore(Z,E?x:l),C&&H(C,0,v-C.scrollTop),$=Z.parentNode,void 0===y||Ct||(yt=Math.abs(y-X(l)[_])),N(),A(!0)}}else{if(m===Z)return A(!1);if((l=m&&a===n.target?m:l)&&(D=X(l)),!1!==Ht(J,a,Z,o,l,D,n,!!l))return M(),m&&m.nextSibling?a.insertBefore(Z,m.nextSibling):a.appendChild(Z),$=a,N(),A(!0)}if(a.contains(Z))return A(!1)}return!1}function O(t,e){U(t,f,I({evt:n,isOwner:d,axis:r?"vertical":"horizontal",revert:i,dragRect:o,targetRect:D,canSort:h,fromSortable:p,target:l,completed:A,onMove:function(t,e){return Ht(J,a,Z,o,t,X(t),n,e)},changed:N},e))}function M(){O("dragOverAnimationCapture"),f.captureAnimationState(),f!==p&&p.captureAnimationState()}function A(t){return O("dragOverCompleted",{insertion:t}),t&&(d?u._hideClone():u._showClone(f),f!==p&&(k(Z,(ct||u).options.ghostClass,!1),k(Z,s.ghostClass,!0)),ct!==f&&f!==jt.active?ct=f:f===jt.active&&ct&&(ct=null),p===f&&(f._ignoreWhileAnimating=l),f.animateAll(function(){O("dragOverAnimationComplete"),f._ignoreWhileAnimating=null}),f!==p&&(p.animateAll(),p._ignoreWhileAnimating=null)),(l===Z&&!Z.animated||l===a&&!l.animated)&&(vt=null),s.dragoverBubble||n.rootEl||l===document||(Z.parentNode[K]._isOutsideThisEl(n.target),t||Bt(n)),!s.dragoverBubble&&n.stopPropagation&&n.stopPropagation(),g=!0}function N(){rt=j(Z),lt=j(Z,s.draggable),V({sortable:f,name:"change",toEl:a,newIndex:rt,newDraggableIndex:lt,originalEvent:n})}},_ignoreWhileAnimating:null,_offMoveEvents:function(){p(document,"mousemove",this._onTouchMove),p(document,"touchmove",this._onTouchMove),p(document,"pointermove",this._onTouchMove),p(document,"dragover",Bt),p(document,"mousemove",Bt),p(document,"touchmove",Bt)},_offUpEvents:function(){var t=this.el.ownerDocument;p(t,"mouseup",this._onDrop),p(t,"touchend",this._onDrop),p(t,"pointerup",this._onDrop),p(t,"pointercancel",this._onDrop),p(t,"touchcancel",this._onDrop),p(document,"selectstart",this)},_onDrop:function(t){var e=this.el,n=this.options;rt=j(Z),lt=j(Z,n.draggable),U("drop",this,{evt:t}),$=Z&&Z.parentNode,rt=j(Z),lt=j(Z,n.draggable),jt.eventCanceled||(_t=Ct=Dt=!1,clearInterval(this._loopId),clearTimeout(this._dragStartTimer),zt(this.cloneId),zt(this._dragStartId),this.nativeDraggable&&(p(document,"drop",this),p(e,"dragstart",this._onDragStart)),this._offMoveEvents(),this._offUpEvents(),u&&R(document.body,"user-select",""),R(Z,"transform",""),t&&(mt&&(t.cancelable&&t.preventDefault(),n.dropBubble||t.stopPropagation()),Q&&Q.parentNode&&Q.parentNode.removeChild(Q),(J===$||ct&&"clone"!==ct.lastPutMode)&&nt&&nt.parentNode&&nt.parentNode.removeChild(nt),Z&&(this.nativeDraggable&&p(Z,"dragend",this),Lt(Z),Z.style["will-change"]="",mt&&!Dt&&k(Z,(ct||this).options.ghostClass,!1),k(Z,this.options.chosenClass,!1),V({sortable:this,name:"unchoose",toEl:$,newIndex:null,newDraggableIndex:null,originalEvent:t}),J!==$?(0<=rt&&(V({rootEl:$,name:"add",toEl:$,fromEl:J,originalEvent:t}),V({sortable:this,name:"remove",toEl:$,originalEvent:t}),V({rootEl:$,name:"sort",toEl:$,fromEl:J,originalEvent:t}),V({sortable:this,name:"sort",toEl:$,originalEvent:t})),ct&&ct.save()):rt!==it&&0<=rt&&(V({sortable:this,name:"update",toEl:$,originalEvent:t}),V({sortable:this,name:"sort",toEl:$,originalEvent:t})),jt.active&&(null!=rt&&-1!==rt||(rt=it,lt=at),V({sortable:this,name:"end",toEl:$,originalEvent:t}),this.save())))),this._nulling()},_nulling:function(){U("nulling",this),J=Z=$=Q=tt=nt=et=ot=ut=dt=mt=rt=lt=it=at=vt=bt=ct=st=jt.dragged=jt.ghost=jt.clone=jt.active=null,Ot.forEach(function(t){t.checked=!0}),Ot.length=ht=pt=0},handleEvent:function(t){switch(t.type){case"drop":case"dragend":this._onDrop(t);break;case"dragenter":case"dragover":Z&&(this._onDragOver(t),function(t){t.dataTransfer&&(t.dataTransfer.dropEffect="move");t.cancelable&&t.preventDefault()}(t));break;case"selectstart":t.preventDefault()}},toArray:function(){for(var t,e=[],n=this.el.children,o=0,i=n.length,r=this.options;o<i;o++)P(t=n[o],r.draggable,this.el,!1)&&e.push(t.getAttribute(r.dataIdAttr)||function(t){var e=t.tagName+t.className+t.src+t.href+t.textContent,n=e.length,o=0;for(;n--;)o+=e.charCodeAt(n);return o.toString(36)}(t));return e},sort:function(t,e){var n={},o=this.el;this.toArray().forEach(function(t,e){e=o.children[e];P(e,this.options.draggable,o,!1)&&(n[t]=e)},this),e&&this.captureAnimationState(),t.forEach(function(t){n[t]&&(o.removeChild(n[t]),o.appendChild(n[t]))}),e&&this.animateAll()},save:function(){var t=this.options.store;t&&t.set&&t.set(this)},closest:function(t,e){return P(t,e||this.options.draggable,this.el,!1)},option:function(t,e){var n=this.options;if(void 0===e)return n[t];var o=z.modifyOption(this,t,e);n[t]=void 0!==o?o:e,"group"===t&&Rt(n)},destroy:function(){U("destroy",this);var t=this.el;t[K]=null,p(t,"mousedown",this._onTapStart),p(t,"touchstart",this._onTapStart),p(t,"pointerdown",this._onTapStart),this.nativeDraggable&&(p(t,"dragover",this),p(t,"dragenter",this)),Array.prototype.forEach.call(t.querySelectorAll("[draggable]"),function(t){t.removeAttribute("draggable")}),this._onDrop(),this._disableDelayedDragEvents(),St.splice(St.indexOf(this.el),1),this.el=t=null},_hideClone:function(){ot||(U("hideClone",this),jt.eventCanceled||(R(nt,"display","none"),this.options.removeCloneOnHide&&nt.parentNode&&nt.parentNode.removeChild(nt),ot=!0))},_showClone:function(t){"clone"===t.lastPutMode?ot&&(U("showClone",this),jt.eventCanceled||(Z.parentNode!=J||this.options.group.revertClone?tt?J.insertBefore(nt,tt):J.appendChild(nt):J.insertBefore(nt,Z),this.options.group.revertClone&&this.animate(Z,nt),R(nt,"display",""),ot=!1)):this._hideClone()}},Mt&&h(document,"touchmove",function(t){(jt.active||Dt)&&t.cancelable&&t.preventDefault()}),jt.utils={on:h,off:p,css:R,find:D,is:function(t,e){return!!P(t,e,t,!1)},extend:function(t,e){if(t&&e)for(var n in e)e.hasOwnProperty(n)&&(t[n]=e[n]);return t},throttle:_,closest:P,toggleClass:k,clone:C,index:j,nextTick:Wt,cancelNextTick:zt,detectDirection:kt,getChild:B,expando:K},jt.get=function(t){return t[K]},jt.mount=function(){for(var t=arguments.length,e=new Array(t),n=0;n<t;n++)e[n]=arguments[n];(e=e[0].constructor===Array?e[0]:e).forEach(function(t){if(!t.prototype||!t.prototype.constructor)throw"Sortable: Mounted plugin must be a constructor function, not ".concat({}.toString.call(t));t.utils&&(jt.utils=I(I({},jt.utils),t.utils)),z.mount(t)})},jt.create=function(t,e){return new jt(t,e)};var Gt,Ut,qt,Vt,Zt,$t,Qt=[],Jt=!(jt.version="1.15.6");function te(){Qt.forEach(function(t){clearInterval(t.pid)}),Qt=[]}function ee(){clearInterval($t)}var ne,oe=_(function(n,t,e,o){if(t.scroll){var i,r=(n.touches?n.touches[0]:n).clientX,a=(n.touches?n.touches[0]:n).clientY,l=t.scrollSensitivity,s=t.scrollSpeed,c=O(),u=!1;Ut!==e&&(Ut=e,te(),Gt=t.scroll,i=t.scrollFn,!0===Gt&&(Gt=M(e,!0)));var d=0,h=Gt;do{var p=h,f=X(p),g=f.top,m=f.bottom,v=f.left,b=f.right,y=f.width,w=f.height,D=void 0,E=void 0,S=p.scrollWidth,_=p.scrollHeight,C=R(p),T=p.scrollLeft,f=p.scrollTop,E=p===c?(D=y<S&&("auto"===C.overflowX||"scroll"===C.overflowX||"visible"===C.overflowX),w<_&&("auto"===C.overflowY||"scroll"===C.overflowY||"visible"===C.overflowY)):(D=y<S&&("auto"===C.overflowX||"scroll"===C.overflowX),w<_&&("auto"===C.overflowY||"scroll"===C.overflowY)),T=D&&(Math.abs(b-r)<=l&&T+y<S)-(Math.abs(v-r)<=l&&!!T),f=E&&(Math.abs(m-a)<=l&&f+w<_)-(Math.abs(g-a)<=l&&!!f);if(!Qt[d])for(var x=0;x<=d;x++)Qt[x]||(Qt[x]={});Qt[d].vx==T&&Qt[d].vy==f&&Qt[d].el===p||(Qt[d].el=p,Qt[d].vx=T,Qt[d].vy=f,clearInterval(Qt[d].pid),0==T&&0==f||(u=!0,Qt[d].pid=setInterval(function(){o&&0===this.layer&&jt.active._onTouchMove(Zt);var t=Qt[this.layer].vy?Qt[this.layer].vy*s:0,e=Qt[this.layer].vx?Qt[this.layer].vx*s:0;"function"==typeof i&&"continue"!==i.call(jt.dragged.parentNode[K],e,t,n,Zt,Qt[this.layer].el)||H(Qt[this.layer].el,e,t)}.bind({layer:d}),24))),d++}while(t.bubbleScroll&&h!==c&&(h=M(h,!1)));Jt=u}},30),n=function(t){var e=t.originalEvent,n=t.putSortable,o=t.dragEl,i=t.activeSortable,r=t.dispatchSortableEvent,a=t.hideGhostForTarget,t=t.unhideGhostForTarget;e&&(i=n||i,a(),e=e.changedTouches&&e.changedTouches.length?e.changedTouches[0]:e,e=document.elementFromPoint(e.clientX,e.clientY),t(),i&&!i.el.contains(e)&&(r("spill"),this.onSpill({dragEl:o,putSortable:n})))};function ie(){}function re(){}ie.prototype={startIndex:null,dragStart:function(t){t=t.oldDraggableIndex;this.startIndex=t},onSpill:function(t){var e=t.dragEl,n=t.putSortable;this.sortable.captureAnimationState(),n&&n.captureAnimationState();t=B(this.sortable.el,this.startIndex,this.options);t?this.sortable.el.insertBefore(e,t):this.sortable.el.appendChild(e),this.sortable.animateAll(),n&&n.animateAll()},drop:n},a(ie,{pluginName:"revertOnSpill"}),re.prototype={onSpill:function(t){var e=t.dragEl,t=t.putSortable||this.sortable;t.captureAnimationState(),e.parentNode&&e.parentNode.removeChild(e),t.animateAll()},drop:n},a(re,{pluginName:"removeOnSpill"});var ae,le,se,ce,ue,de=[],he=[],pe=!1,fe=!1,ge=!1;function me(n,o){he.forEach(function(t,e){e=o.children[t.sortableIndex+(n?Number(e):0)];e?o.insertBefore(t,e):o.appendChild(t)})}function ve(){de.forEach(function(t){t!==se&&t.parentNode&&t.parentNode.removeChild(t)})}return jt.mount(new function(){function t(){for(var t in this.defaults={scroll:!0,forceAutoScrollFallback:!1,scrollSensitivity:30,scrollSpeed:10,bubbleScroll:!0},this)"_"===t.charAt(0)&&"function"==typeof this[t]&&(this[t]=this[t].bind(this))}return t.prototype={dragStarted:function(t){t=t.originalEvent;this.sortable.nativeDraggable?h(document,"dragover",this._handleAutoScroll):this.options.supportPointer?h(document,"pointermove",this._handleFallbackAutoScroll):t.touches?h(document,"touchmove",this._handleFallbackAutoScroll):h(document,"mousemove",this._handleFallbackAutoScroll)},dragOverCompleted:function(t){t=t.originalEvent;this.options.dragOverBubble||t.rootEl||this._handleAutoScroll(t)},drop:function(){this.sortable.nativeDraggable?p(document,"dragover",this._handleAutoScroll):(p(document,"pointermove",this._handleFallbackAutoScroll),p(document,"touchmove",this._handleFallbackAutoScroll),p(document,"mousemove",this._handleFallbackAutoScroll)),ee(),te(),clearTimeout(m),m=void 0},nulling:function(){Zt=Ut=Gt=Jt=$t=qt=Vt=null,Qt.length=0},_handleFallbackAutoScroll:function(t){this._handleAutoScroll(t,!0)},_handleAutoScroll:function(e,n){var o,i=this,r=(e.touches?e.touches[0]:e).clientX,a=(e.touches?e.touches[0]:e).clientY,t=document.elementFromPoint(r,a);Zt=e,n||this.options.forceAutoScrollFallback||w||y||u?(oe(e,this.options,t,n),o=M(t,!0),!Jt||$t&&r===qt&&a===Vt||($t&&ee(),$t=setInterval(function(){var t=M(document.elementFromPoint(r,a),!0);t!==o&&(o=t,te()),oe(e,i.options,t,n)},10),qt=r,Vt=a)):this.options.bubbleScroll&&M(t,!0)!==O()?oe(e,this.options,M(t,!1),!1):te()}},a(t,{pluginName:"scroll",initializeByDefault:!0})}),jt.mount(re,ie),jt.mount(new function(){function t(){this.defaults={swapClass:"sortable-swap-highlight"}}return t.prototype={dragStart:function(t){t=t.dragEl;ne=t},dragOverValid:function(t){var e=t.completed,n=t.target,o=t.onMove,i=t.activeSortable,r=t.changed,a=t.cancel;i.options.swap&&(t=this.sortable.el,i=this.options,n&&n!==t&&(t=ne,ne=!1!==o(n)?(k(n,i.swapClass,!0),n):null,t&&t!==ne&&k(t,i.swapClass,!1)),r(),e(!0),a())},drop:function(t){var e,n,o=t.activeSortable,i=t.putSortable,r=t.dragEl,a=i||this.sortable,l=this.options;ne&&k(ne,l.swapClass,!1),ne&&(l.swap||i&&i.options.swap)&&r!==ne&&(a.captureAnimationState(),a!==o&&o.captureAnimationState(),n=ne,t=(e=r).parentNode,l=n.parentNode,t&&l&&!t.isEqualNode(n)&&!l.isEqualNode(e)&&(i=j(e),r=j(n),t.isEqualNode(l)&&i<r&&r++,t.insertBefore(n,t.children[i]),l.insertBefore(e,l.children[r])),a.animateAll(),a!==o&&o.animateAll())},nulling:function(){ne=null}},a(t,{pluginName:"swap",eventProperties:function(){return{swapItem:ne}}})}),jt.mount(new function(){function t(o){for(var t in this)"_"===t.charAt(0)&&"function"==typeof this[t]&&(this[t]=this[t].bind(this));o.options.avoidImplicitDeselect||(o.options.supportPointer?h(document,"pointerup",this._deselectMultiDrag):(h(document,"mouseup",this._deselectMultiDrag),h(document,"touchend",this._deselectMultiDrag))),h(document,"keydown",this._checkKeyDown),h(document,"keyup",this._checkKeyUp),this.defaults={selectedClass:"sortable-selected",multiDragKey:null,avoidImplicitDeselect:!1,setData:function(t,e){var n="";de.length&&le===o?de.forEach(function(t,e){n+=(e?", ":"")+t.textContent}):n=e.textContent,t.setData("Text",n)}}}return t.prototype={multiDragKeyDown:!1,isMultiDrag:!1,delayStartGlobal:function(t){t=t.dragEl;se=t},delayEnded:function(){this.isMultiDrag=~de.indexOf(se)},setupClone:function(t){var e=t.sortable,t=t.cancel;if(this.isMultiDrag){for(var n=0;n<de.length;n++)he.push(C(de[n])),he[n].sortableIndex=de[n].sortableIndex,he[n].draggable=!1,he[n].style["will-change"]="",k(he[n],this.options.selectedClass,!1),de[n]===se&&k(he[n],this.options.chosenClass,!1);e._hideClone(),t()}},clone:function(t){var e=t.sortable,n=t.rootEl,o=t.dispatchSortableEvent,t=t.cancel;this.isMultiDrag&&(this.options.removeCloneOnHide||de.length&&le===e&&(me(!0,n),o("clone"),t()))},showClone:function(t){var e=t.cloneNowShown,n=t.rootEl,t=t.cancel;this.isMultiDrag&&(me(!1,n),he.forEach(function(t){R(t,"display","")}),e(),ue=!1,t())},hideClone:function(t){var e=this,n=(t.sortable,t.cloneNowHidden),t=t.cancel;this.isMultiDrag&&(he.forEach(function(t){R(t,"display","none"),e.options.removeCloneOnHide&&t.parentNode&&t.parentNode.removeChild(t)}),n(),ue=!0,t())},dragStartGlobal:function(t){t.sortable;!this.isMultiDrag&&le&&le.multiDrag._deselectMultiDrag(),de.forEach(function(t){t.sortableIndex=j(t)}),de=de.sort(function(t,e){return t.sortableIndex-e.sortableIndex}),ge=!0},dragStarted:function(t){var e,n=this,t=t.sortable;this.isMultiDrag&&(this.options.sort&&(t.captureAnimationState(),this.options.animation&&(de.forEach(function(t){t!==se&&R(t,"position","absolute")}),e=X(se,!1,!0,!0),de.forEach(function(t){t!==se&&T(t,e)}),pe=fe=!0)),t.animateAll(function(){pe=fe=!1,n.options.animation&&de.forEach(function(t){x(t)}),n.options.sort&&ve()}))},dragOver:function(t){var e=t.target,n=t.completed,t=t.cancel;fe&&~de.indexOf(e)&&(n(!1),t())},revert:function(t){var n,o,e=t.fromSortable,i=t.rootEl,r=t.sortable,a=t.dragRect;1<de.length&&(de.forEach(function(t){r.addAnimationState({target:t,rect:fe?X(t):a}),x(t),t.fromRect=a,e.removeAnimationState(t)}),fe=!1,n=!this.options.removeCloneOnHide,o=i,de.forEach(function(t,e){e=o.children[t.sortableIndex+(n?Number(e):0)];e?o.insertBefore(t,e):o.appendChild(t)}))},dragOverCompleted:function(t){var e,n=t.sortable,o=t.isOwner,i=t.insertion,r=t.activeSortable,a=t.parentEl,l=t.putSortable,t=this.options;i&&(o&&r._hideClone(),pe=!1,t.animation&&1<de.length&&(fe||!o&&!r.options.sort&&!l)&&(e=X(se,!1,!0,!0),de.forEach(function(t){t!==se&&(T(t,e),a.appendChild(t))}),fe=!0),o||(fe||ve(),1<de.length?(o=ue,r._showClone(n),r.options.animation&&!ue&&o&&he.forEach(function(t){r.addAnimationState({target:t,rect:ce}),t.fromRect=ce,t.thisAnimationDuration=null})):r._showClone(n)))},dragOverAnimationCapture:function(t){var e=t.dragRect,n=t.isOwner,t=t.activeSortable;de.forEach(function(t){t.thisAnimationDuration=null}),t.options.animation&&!n&&t.multiDrag.isMultiDrag&&(ce=a({},e),e=b(se,!0),ce.top-=e.f,ce.left-=e.e)},dragOverAnimationComplete:function(){fe&&(fe=!1,ve())},drop:function(t){var o,i,r,a,n,e,l,s=t.originalEvent,c=t.rootEl,u=t.parentEl,d=t.sortable,h=t.dispatchSortableEvent,p=t.oldIndex,t=t.putSortable,f=t||this.sortable;s&&(o=this.options,i=u.children,ge||(o.multiDragKey&&!this.multiDragKeyDown&&this._deselectMultiDrag(),k(se,o.selectedClass,!~de.indexOf(se)),~de.indexOf(se)?(de.splice(de.indexOf(se),1),ae=null,G({sortable:d,rootEl:c,name:"deselect",targetEl:se,originalEvent:s})):(de.push(se),G({sortable:d,rootEl:c,name:"select",targetEl:se,originalEvent:s}),s.shiftKey&&ae&&d.el.contains(ae)?(r=j(ae),a=j(se),~r&&~a&&r!==a&&function(){for(var e,t=r<a?(e=r,a):(e=a,r+1),n=o.filter;e<t;e++)~de.indexOf(i[e])||P(i[e],o.draggable,u,!1)&&(n&&("function"==typeof n?n.call(d,s,i[e],d):n.split(",").some(function(t){return P(i[e],t.trim(),u,!1)}))||(k(i[e],o.selectedClass,!0),de.push(i[e]),G({sortable:d,rootEl:c,name:"select",targetEl:i[e],originalEvent:s})))}()):ae=se,le=f)),ge&&this.isMultiDrag&&(fe=!1,(u[K].options.sort||u!==c)&&1<de.length&&(n=X(se),e=j(se,":not(."+this.options.selectedClass+")"),!pe&&o.animation&&(se.thisAnimationDuration=null),f.captureAnimationState(),pe||(o.animation&&(se.fromRect=n,de.forEach(function(t){var e;t.thisAnimationDuration=null,t!==se&&(e=fe?X(t):n,t.fromRect=e,f.addAnimationState({target:t,rect:e}))})),ve(),de.forEach(function(t){i[e]?u.insertBefore(t,i[e]):u.appendChild(t),e++}),p===j(se)&&(l=!1,de.forEach(function(t){t.sortableIndex!==j(t)&&(l=!0)}),l&&(h("update"),h("sort")))),de.forEach(function(t){x(t)}),f.animateAll()),le=f),(c===u||t&&"clone"!==t.lastPutMode)&&he.forEach(function(t){t.parentNode&&t.parentNode.removeChild(t)}))},nullingGlobal:function(){this.isMultiDrag=ge=!1,he.length=0},destroyGlobal:function(){this._deselectMultiDrag(),p(document,"pointerup",this._deselectMultiDrag),p(document,"mouseup",this._deselectMultiDrag),p(document,"touchend",this._deselectMultiDrag),p(document,"keydown",this._checkKeyDown),p(document,"keyup",this._checkKeyUp)},_deselectMultiDrag:function(t){if(!(void 0!==ge&&ge||le!==this.sortable||t&&P(t.target,this.options.draggable,this.sortable.el,!1)||t&&0!==t.button))for(;de.length;){var e=de[0];k(e,this.options.selectedClass,!1),de.shift(),G({sortable:this.sortable,rootEl:this.sortable.el,name:"deselect",targetEl:e,originalEvent:t})}},_checkKeyDown:function(t){t.key===this.options.multiDragKey&&(this.multiDragKeyDown=!0)},_checkKeyUp:function(t){t.key===this.options.multiDragKey&&(this.multiDragKeyDown=!1)}},a(t,{pluginName:"multiDrag",utils:{select:function(t){var e=t.parentNode[K];e&&e.options.multiDrag&&!~de.indexOf(t)&&(le&&le!==e&&(le.multiDrag._deselectMultiDrag(),le=e),k(t,e.options.selectedClass,!0),de.push(t))},deselect:function(t){var e=t.parentNode[K],n=de.indexOf(t);e&&e.options.multiDrag&&~n&&(k(t,e.options.selectedClass,!1),de.splice(n,1))}},eventProperties:function(){var n=this,o=[],i=[];return de.forEach(function(t){var e;o.push({multiDragElement:t,index:t.sortableIndex}),e=fe&&t!==se?-1:fe?j(t,":not(."+n.options.selectedClass+")"):j(t),i.push({multiDragElement:t,index:e})}),{items:r(de),clones:[].concat(he),oldIndicies:o,newIndicies:i}},optionListeners:{multiDragKey:function(t){return"ctrl"===(t=t.toLowerCase())?t="Control":1<t.length&&(t=t.charAt(0).toUpperCase()+t.substr(1)),t}}})}),jt});
  return module.exports;
})();

/* tugtile plugin source. The build process inlines vendor/Sortable.min.js inside an isolated wrapper before this file,
   providing the global `Sortable`. The final build output is a single-file main.js. */
const { Plugin, ItemView, MarkdownRenderer, Notice, Component, Menu, WorkspaceLeaf, MarkdownView, Modal, PluginSettingTab, Setting, Platform, setIcon } = require('obsidian');

/* ===================== i18n =====================
   Externalizes user-facing strings. Defaults to English (en-US) and follows the Obsidian UI language.
   Only translate string values; do not modify any logic, formats, or kanban:settings keys.
   - LOCALE: Reads Obsidian's language setting (localStorage 'language') and maps it to one of the 4 supported locales; falls back to en-US for others (including Simplified Chinese).
   - TR: A translation table for 4 languages. Keys are semantic English; values requiring interpolation use functions.
   - t(key, ...args): Looks up the key in the current locale -> falls back to en-US -> falls back to the key itself; executes it if it is a function.
   Terminology (SSOT out/i18n-naming.md): tile=card / board=board / lane=lane / archive=archive / delete=delete / undo=undo (restore). */
const LOCALE = (() => {
  let lang = '';
  try { lang = (window.localStorage.getItem('language') || ''); } catch (e) { lang = ''; }
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang === 'ja') return 'ja-JP';
  if (lang === 'ko') return 'ko-KR';
  return 'en-US';   // Defaults to English for other settings (e.g., Simplified Chinese 'zh', 'en', unset, etc.)
})();

const TR = {"en-US": {"appName": "tugtile", "brandSuffix": "tugtile-ing", "brandSuffixLocked": "tugtile", "lockToggle": "Lock / unlock board", "lockedNotice": "Board is locked", "undoAction": "Undo", "redoAction": "Redo", "viewSwitchAction": "Switch view (Board / Table)", "boardSettingsAction": "Board settings", "openAsMarkdownAction": "Open as markdown", "archiveAction": "Stash (Archive)", "searchAction": "Search tiles", "emptyNoFile": "Open a board .md with the “Open as tugtile” command.", "fileNotFound": "File not found: {0}", "searchPlaceholder": "Find a tile", "viewBoard": "Board", "viewTable": "Table", "editMarkdown": "Edit raw markdown", "findPlaceholder": "Find", "replacePlaceholder": "Replace", "findPrev": "Previous", "findNext": "Next", "replaceOne": "Replace", "replaceAll": "Replace all", "colTile": "Tile", "colLane": "Lane", "colDate": "Date", "colTags": "Tags", "collapseExpand": "Collapse / expand", "laneActionsAria": "Lane actions (rename / insert / sort / stash / delete…)", "tileActionsAria": "More actions (edit / stash / delete…)", "relDateWrap": " ({0})", "today": "today", "tomorrow": "tomorrow", "yesterday": "yesterday", "dayAfterTomorrow": "in 2 days", "dayBeforeYesterday": "2 days ago", "daysLater": "in {0} days", "daysAgo": "{0} days ago", "yearMonth": "{0}-{1}", "weekdays": ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"], "edit": "Edit", "duplicateTile": "Duplicate", "insertTileAbove": "Insert tile above", "insertTileBelow": "Insert tile below", "splitTileMenu": "Split into tiles", "archiveTileMenu": "Stash (Archive)", "moveTileTop": "Move to top", "moveTileBottom": "Move to bottom", "untitledLane": "(untitled)", "moveToLane": "Move to “{0}”", "deleteTileMenu": "Delete", "splitNoNeed": "Only one line — nothing to split.", "splitDone": "Split into {0} tiles", "archivedTile": "Tile stashed", "deletedTile": "Tile deleted", "deletedLane": "Lane deleted", "toastUndoBtn": "Undo", "addTileBtn": "＋ Add a tile", "dropToArchive": "Drop here to stash", "cancel": "Cancel", "save": "Save", "discardConfirm": "Discard your changes?", "editLost": "Tile no longer exists — edit not saved.", "mobileSubmit": "Submit", "addLaneBtn": "＋ Add lane", "addLanePlaceholder": "Lane name — ⏎ to add", "newLane": "New lane", "newBoardName": "New board", "confirmDeleteLane": "This lane has {0} tiles. Delete the whole lane?", "boardListViewOnly": "Use this in Board view", "archivedCompleted": "Stashed {0} completed tiles", "noCompleted": "No completed tiles", "rename": "Rename", "insertLaneBefore": "Insert lane before", "insertLaneAfter": "Insert lane after", "sortTitleAsc": "Sort by tile title A→Z", "sortTitleDesc": "Sort by tile title Z→A", "sortDate": "Sort by date (soonest first)", "sortTag": "Sort by tag", "markLaneComplete": "Mark all in lane complete", "archiveLaneMenu": "Stash all tiles in lane", "deleteLaneMenu": "Delete lane", "confirmArchiveLane": "Stash all {0} tiles in this lane?", "archivedLane": "Stashed {0} tiles from lane", "noLaneToRestore": "tugtile: no lane to restore into — create a lane first", "externalModified": "tugtile: this file was changed elsewhere — reloaded to avoid overwrite (this step was not saved)", "backupFailed": "tugtile: backup failed — write cancelled to protect your data", "writeFailed": "tugtile write failed: {0}", "saved": "Saved", "persistFailed": "tugtile: save failed — {0}", "undoVerb": "undo", "redoVerb": "redo", "noStep": "tugtile: nothing left to {0}", "timeTraveled": "tugtile: {0} done (undo {1} / redo {2})", "archiveTitle": "Stash (Archive)", "archiveEmpty": "No stashed tiles.", "restore": "Restore", "deleteArchived": "Delete", "boardSettingsTitle": "Board settings", "boardSettingsDesc": "Affects only this board (saved with the board file). Blank = follow the global default.", "migrateBtn": "Upgrade to tugtile format", "migrateBtnDesc": "Remove obsidian-kanban markers so this board is tugtile-native. One-way.", "migrateConfirm": "Upgrade this board to tugtile’s own format? It will no longer open in obsidian-kanban, and kanban-only settings will be dropped.", "migrateDone": "Upgraded to tugtile format", "confirm": "Confirm", "setShowCheckboxes": "Show tile checkbox", "setHideCount": "Hide lane count", "setEnterBehavior": "Enter key behavior", "setEnterBehaviorDesc": "shift-enter = Enter submits (CJK friendly); enter = Enter newline", "optEnterSubmit": "Enter submits", "optEnterNewline": "Enter newline", "setNewCardPos": "New tile position", "optAppend": "At lane bottom", "optPrepend": "At lane top", "optPrependCompact": "At lane top (compact)", "setRelativeDate": "Show relative date", "setRelativeDateDesc": "today / tomorrow / in N days", "setDateFormat": "Date storage format", "setDateFormatDesc": "Format written into markdown (e.g. YYYY-MM-DD)", "setDateDisplay": "Date display format", "setDateDisplayDesc": "Format shown on tiles", "setDateTrigger": "Date trigger char", "setDateTriggerDesc": "Default @", "setTimeTrigger": "Time trigger char", "setTimeTriggerDesc": "Default @@", "setLinkDaily": "Link date to daily note", "setLinkDailyDesc": "Write date as @[[..]] linking to the daily note", "setTagAction": "Tag click action", "setTagActionDesc": "What clicking a tag does — search the whole vault, or filter just this board.", "optSearchVault": "Search whole vault", "optFilterBoard": "Filter this board", "setMoveTags": "Move tags to tile footer", "setArchiveWithDate": "Add timestamp on stash", "settingsTitle": "tugtile settings", "settingsDesc": "These are global defaults; a board’s own settings of the same name take precedence.", "gShowCheckboxes": "Show tile checkbox", "gShowCheckboxesDesc": "Show a checkbox at the top-right of each tile (toggles - [ ] / - [x])", "gHideCount": "Hide lane count", "gHideCountDesc": "Don’t show the tile count in the lane header", "gResponsiveBoard": "Responsive board (stack on narrow panes)", "gResponsiveBoardDesc": "On a narrow pane, the board reflows into a single vertical stack.", "gLaneWidth": "Lane width", "gLaneWidthDesc": "Width of every lane — all lanes line up evenly", "gTableDensity": "Table row spacing", "gTableDensityDesc": "Vertical breathing room for each table row", "gFormatTools": "Text formatting buttons", "gFormatToolsDesc": "Headings, bold, italic, strikethrough.", "gInsertTools": "Insert buttons", "gInsertToolsDesc": "Which insert buttons show (code, link, date, time)", "optDenseTight": "Tight", "optDenseMid": "Medium", "optDenseLoose": "Loose", "gEnterSubmit": "Enter submits", "gEnterSubmitDesc": "On: Enter submits, Shift+Enter newline (CJK-friendly default). Off: Enter newline, Shift/⌘+Enter submits", "gPrepend": "Add new tile at top", "gPrependDesc": "Default adds at the bottom; enable to add at the top", "gRelativeDate": "Show relative date", "gRelativeDateDesc": "Show “today / tomorrow / in N days” on tile dates", "gDateDisplay": "Date display format", "gDateDisplayDesc": "moment-style tokens: YYYY / MM / DD (default YYYY-MM-DD)", "gArchiveWithDate": "Add timestamp on stash", "gArchiveWithDateDesc": "Prepend **YYYY-MM-DD HH:mm** to the title when stashing", "gArchiveHeading": "Stash heading", "gArchiveHeadingDesc": "Heading text for a new stash (archive) section (e.g. Archive, 封存).", "gDanger": "Danger zone", "gReset": "Reset to defaults", "gResetDesc": "Restore the above global settings to defaults", "gResetBtn": "Reset", "cmdToggleView": "tugtile: toggle board / markdown", "cmdOpenAsBoard": "Open as tugtile", "cmdUndo": "tugtile: undo", "cmdRedo": "tugtile: redo", "cmdCreateBoard": "tugtile: create new board", "cmdSearch": "tugtile: search tiles (bindable to Cmd/Ctrl+F)", "cmdArchiveCompleted": "tugtile: stash all completed tiles", "cmdConvertToBoard": "tugtile: convert current note to board", "cmdNewCard": "tugtile: new tile in lane", "cmdNewLane": "tugtile: new lane", "cmdRenameLane": "tugtile: rename lane", "createBoardHere": "Create tugtile board here", "openAsBoard": "Open as tugtile board", "ribbonTitle": "tugtile board", "ribbonNoFile": "Open a board .md first", "convertFailed": "tugtile convert failed: {0}", "boardCreated": "Board created: {0} (rename it in the file explorer)", "createBoardFailed": "tugtile create board failed: {0}", "mtRibbon": "Edit in marktile", "mtOpenCmd": "marktile: edit current note", "mtNoFile": "Open a .md note first", "mtBackToObsidian": "Back to Obsidian editor", "openInMarktile": "Open in marktile", "mtToTugtile": "Open as tugtile board", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "Essential buttons", "mtEssentialToolsDesc": "Search, undo, redo", "mtInsertToolsDesc": "Which insert buttons to show (code / link)", "mtDefaultEditor": "Make marktile the default Markdown editor", "mtDefaultEditorDesc": "Off by default. When on, .md files open in marktile instead of Obsidian's editor (board files too — hop to tugtile with its button). Reload Obsidian to apply; turn off anytime to restore the native editor.", "mtReloadRequired": "Reload Obsidian to apply", "mtSettings": "marktile settings", "mtSettingsTitle": "marktile settings", "mtSettingsDesc": "marktile opens any .md note in the tile-family editor. Choose which toolbar buttons appear (uncheck all to hide the toolbar entirely), or make marktile your default Markdown editor.", "mtModePlain": "Plain", "mtModeSeasoned": "Seasoned", "expandAllAction": "Expand all", "collapseAllAction": "Collapse all", "expandLanesAction": "Expand lanes", "mtModeToggle": "Toggle Seasoned / Plain", "mtLockToggle": "Lock editor (read-only)", "mtToc": "Table of contents", "mtTocEmpty": "No headings", "edH1": "Heading 1", "edH2": "Heading 2", "edH3": "Heading 3", "edBold": "Bold", "edItalic": "Italic", "edStrike": "Strikethrough", "edBullet": "Bullet list", "edNumber": "Numbered list", "edCheck": "Checklist", "edQuote": "Blockquote", "edCode": "Inline code", "edLink": "Wikilink", "edDate": "Insert date", "edTime": "Insert time", "edFind": "Find / replace", "TBL_INS_COL_L": "Insert column left", "TBL_INS_COL_R": "Insert column right", "TBL_INS_ROW_A": "Insert row above", "TBL_INS_ROW_B": "Insert row below", "TBL_DEL_COL": "Delete column", "TBL_DEL_ROW": "Delete row", "mtModeRendered": "Rendered", "mtModesPick": "View modes", "mtModesPickDesc": "Which modes the view-cycle button rotates through. At least one stays on.", "mtModesMinOne": "Keep at least one view mode.", "gBlockTools": "Block tools", "gBlockToolsDesc": "Lists, checklist, quote, table.", "edTable": "Table", "edImage": "Insert image", "edVideo": "Insert video", "edVideoPrompt": "Video URL (YouTube / Vimeo / mp4):", "mtSeasonedColor": "Seasoned: colorful syntax", "mtSeasonedColorDesc": "Color each markdown token (headings, bold, code, links) with its own hue instead of a single accent tint.", "backupsAction": "Backups", "backupTitle": "Board backups", "backupDesc": "tugtile snapshots this board to _tugtile-backups/ before the first change each session, and reloads if the file is edited elsewhere — a bad edit or a sync clash never loses your work.", "backupEmpty": "No backups yet — one is made automatically before this board's first change each session.", "backupOpen": "Open", "backupRestoreConfirm": "Replace the current board with this backup? Your current state is backed up first, so this is reversible.", "backupRestored": "tugtile: board restored from backup", "backupRestoreFailed": "tugtile: couldn't restore this backup", "safetyHeading": "Your data is safe", "backupRetentionName": "Backup history limit", "backupRetentionDesc": "How many backups to keep per board; the oldest are removed beyond this (-1 keeps all).", "familyMarktile": "marktile — the companion editor", "familyMarktileDesc": "A Markdown editor where the markers never hide and headings grow — same engine, same feel as the card editor here.", "familyTugtile": "tugtile — the companion board", "familyTugtileDesc": "Turn your Markdown notes into a card board you can tug to reorder. Reads your existing boards.", "familyGet": "View plugin", "familyHave": "You already have the full tile family.", "keyboardHintName": "Keyboard", "keyboardHint": "Tip: focus a card (Tab or click), then use the arrow keys to move it — up/down within a lane, left/right across lanes."}, "ja-JP": {"appName": "タッグタイル", "brandSuffix": "tugtile-ing（タッグタイル中）", "brandSuffixLocked": "tugtile（タッグタイル）", "lockToggle": "ボードをロック／解除", "lockedNotice": "ボードはロックされています", "undoAction": "待った", "redoAction": "やり直し", "viewSwitchAction": "ビュー切替（ボード／表）", "boardSettingsAction": "このボードの設定", "openAsMarkdownAction": "Markdown で開く", "archiveAction": "アーカイブ", "searchAction": "タイルを検索", "emptyNoFile": "ボードの .md でコマンド「tugtile で開く」を使ってください。", "fileNotFound": "ファイルが見つかりません：{0}", "searchPlaceholder": "タイルを探す", "viewBoard": "ボード", "viewTable": "表", "editMarkdown": "Markdown を直接編集", "findPlaceholder": "検索", "replacePlaceholder": "置換後", "findPrev": "前へ", "findNext": "次へ", "replaceOne": "置換", "replaceAll": "すべて置換", "colTile": "タイル", "colLane": "列", "colDate": "日付", "colTags": "タグ", "collapseExpand": "折りたたみ / 展開", "laneActionsAria": "列の操作（名前変更／挿入／並べ替え／アーカイブ／削除…）", "tileActionsAria": "その他の操作（編集／アーカイブ／削除…）", "relDateWrap": "（{0}）", "today": "今日", "tomorrow": "明日", "yesterday": "昨日", "dayAfterTomorrow": "明後日", "dayBeforeYesterday": "一昨日", "daysLater": "{0} 日後", "daysAgo": "{0} 日前", "yearMonth": "{0}年 {1}月", "weekdays": ["日", "月", "火", "水", "木", "金", "土"], "edit": "編集", "duplicateTile": "タイルを複製", "insertTileAbove": "上にタイルを挿入", "insertTileBelow": "下にタイルを挿入", "splitTileMenu": "分割", "archiveTileMenu": "アーカイブ", "moveTileTop": "列の先頭へ", "moveTileBottom": "列の末尾へ", "untitledLane": "(無題)", "moveToLane": "「{0}」へ移動", "deleteTileMenu": "タイルを捨てる", "splitNoNeed": "1行のみ。分割は不要です。", "splitDone": "{0} 枚のタイルに分割しました", "archivedTile": "タイルをアーカイブしました", "deletedTile": "タイルを捨てました", "deletedLane": "列を削除しました", "toastUndoBtn": "待った", "addTileBtn": "＋ タイルを追加", "dropToArchive": "ここにドロップでアーカイブ", "cancel": "キャンセル", "save": "保存", "discardConfirm": "変更を破棄しますか？", "editLost": "このタイルは存在しません。編集は保存されませんでした。", "mobileSubmit": "送信", "addLaneBtn": "＋ 列を追加", "addLanePlaceholder": "列名　⏎ で追加", "newLane": "新しい列", "newBoardName": "新しいボード", "confirmDeleteLane": "この列には {0} 枚のタイルがあります。列ごと削除しますか？", "boardListViewOnly": "ボードビューで使ってください", "archivedCompleted": "完了したタイル {0} 枚をアーカイブしました", "noCompleted": "完了したタイルはありません", "rename": "名前を変更", "insertLaneBefore": "前に列を挿入", "insertLaneAfter": "後に列を挿入", "sortTitleAsc": "タイトルで並べ替え A→Z", "sortTitleDesc": "タイトルで並べ替え Z→A", "sortDate": "日付で並べ替え（近い順）", "sortTag": "タグで並べ替え", "markLaneComplete": "この列をすべて完了にする", "archiveLaneMenu": "この列のタイルをすべてアーカイブ", "deleteLaneMenu": "列を削除", "confirmArchiveLane": "この列の {0} 枚のタイルをすべてアーカイブしますか？", "archivedLane": "この列のタイル {0} 枚をアーカイブしました", "noLaneToRestore": "tugtile：戻せる列がありません。先に列を作成してください", "externalModified": "tugtile：このファイルが別の場所で変更されました。上書きを避けるため再読み込みしました（この操作は保存されていません）", "backupFailed": "tugtile：バックアップに失敗したため、データ保護のため書き込みを中止しました", "writeFailed": "tugtile 書き込み失敗：{0}", "saved": "保存しました", "persistFailed": "tugtile：保存に失敗しました、{0}", "undoVerb": "待った", "redoVerb": "やり直し", "noStep": "tugtile：{0}できる操作がありません", "timeTraveled": "tugtile：{0}しました（待った {1} / やり直し {2}）", "archiveTitle": "アーカイブ", "archiveEmpty": "アーカイブされたタイルはありません。", "restore": "戻す", "deleteArchived": "タイルを捨てる", "boardSettingsTitle": "このボードの設定", "boardSettingsDesc": "このボードだけを変更します（ボードのファイルに保存）。空白＝グローバル既定に従う。", "migrateBtn": "tugtile 形式にアップグレード", "migrateBtnDesc": "obsidian-kanban のマーカーを除去し、このボードを tugtile ネイティブにします。一方向。", "migrateConfirm": "このボードを tugtile 独自の形式にアップグレードしますか？以後 obsidian-kanban では開けなくなり、kanban 専用の設定は削除されます。", "migrateDone": "tugtile 形式にアップグレードしました", "confirm": "確定", "setShowCheckboxes": "タイルのチェックボックスを表示", "setHideCount": "列のカウントを隠す", "setEnterBehavior": "Enter キーの動作", "setEnterBehaviorDesc": "shift-enter＝Enter で送信（CJK 向け）；enter＝Enter で改行", "optEnterSubmit": "Enter で送信", "optEnterNewline": "Enter で改行", "setNewCardPos": "新しいタイルの位置", "optAppend": "列の末尾", "optPrepend": "列の先頭", "optPrependCompact": "列の先頭(コンパクト)", "setRelativeDate": "相対日付を表示", "setRelativeDateDesc": "今日 / 明日 / N 日後", "setDateFormat": "日付の保存形式", "setDateFormatDesc": "markdown に書き込む形式（例 YYYY-MM-DD）", "setDateDisplay": "日付の表示形式", "setDateDisplayDesc": "タイルに表示する形式", "setDateTrigger": "日付トリガー文字", "setDateTriggerDesc": "既定 @", "setTimeTrigger": "時刻トリガー文字", "setTimeTriggerDesc": "既定 @@", "setLinkDaily": "日付をデイリーノートにリンク", "setLinkDailyDesc": "日付を @[[..]] と書きデイリーノートにリンク", "setTagAction": "タグクリックの動作", "setTagActionDesc": "タグをクリックしたときの動作：vault 全体を検索、またはこのボードだけを絞り込み。", "optSearchVault": "vault 全体を検索", "optFilterBoard": "このボードを絞り込み", "setMoveTags": "タグをタイルの下部へ移動", "setArchiveWithDate": "アーカイブ時にタイムスタンプ", "settingsTitle": "tugtile 設定", "settingsDesc": "これらはグローバル既定です。各ボードの同名設定が優先されます。", "gShowCheckboxes": "タイルのチェックボックスを表示", "gShowCheckboxesDesc": "各タイルの右上にチェックボックスを表示（- [ ] / - [x] を切替）", "gHideCount": "列のカウントを隠す", "gHideCountDesc": "列のヘッダーにタイル数を表示しない", "gResponsiveBoard": "レスポンシブボード（狭い画面で縦積み）", "gResponsiveBoardDesc": "画面が狭いとき、ボードを自動で縦一列に並べ替えます。", "gLaneWidth": "列の幅", "gLaneWidthDesc": "各列の幅。すべての列が同じ幅で揃います", "gTableDensity": "表の行間隔", "gTableDensityDesc": "表の各行の上下の間隔", "gFormatTools": "文字書式ボタン", "gFormatToolsDesc": "見出し・太字・斜体・打ち消し線。", "gInsertTools": "挿入ボタン", "gInsertToolsDesc": "表示する挿入ボタンを選択（コード／リンク／日付／時刻）", "optDenseTight": "詰める", "optDenseMid": "標準", "optDenseLoose": "ゆったり", "gEnterSubmit": "Enter で送信", "gEnterSubmitDesc": "オン：Enter で送信、Shift+Enter で改行（CJK 向け既定）。オフ：Enter で改行、Shift/⌘+Enter で送信", "gPrepend": "新しいタイルを先頭に追加", "gPrependDesc": "既定は末尾に追加。オンで先頭に追加", "gRelativeDate": "相対日付を表示", "gRelativeDateDesc": "タイルの日付に「今日 / 明日 / N 日後」を表示", "gDateDisplay": "日付の表示形式", "gDateDisplayDesc": "moment 形式トークン：YYYY / MM / DD（既定 YYYY-MM-DD）", "gArchiveWithDate": "アーカイブ時にタイムスタンプ", "gArchiveWithDateDesc": "アーカイブ時にタイトルの前へ **YYYY-MM-DD HH:mm** を付加", "gArchiveHeading": "アーカイブ見出し", "gArchiveHeadingDesc": "新しいアーカイブ節の見出し文字（例 Archive、封存）。", "gDanger": "危険な操作", "gReset": "既定値にリセット", "gResetDesc": "上記のグローバル設定を既定に戻す", "gResetBtn": "リセット", "cmdToggleView": "tugtile：ボード / markdown を切替", "cmdOpenAsBoard": "tugtile で開く", "cmdUndo": "tugtile：待った（元に戻す）", "cmdRedo": "tugtile：やり直し", "cmdCreateBoard": "tugtile：新しいボードを作成", "cmdSearch": "tugtile：タイルを検索（Cmd/Ctrl+F に割当可）", "cmdArchiveCompleted": "tugtile：完了したタイルをすべてアーカイブ", "cmdConvertToBoard": "tugtile：現在のノートをボードに変換", "cmdNewCard": "tugtile：列に新しいタイル", "cmdNewLane": "tugtile：列を追加", "cmdRenameLane": "tugtile：列名を変更", "createBoardHere": "ここに tugtile ボードを作成", "openAsBoard": "tugtile ボードで開く", "ribbonTitle": "tugtile ボード", "ribbonNoFile": "先にボードの .md を開いてください", "convertFailed": "tugtile 変換失敗：{0}", "boardCreated": "ボードを作成しました：{0}（ファイルエクスプローラーで名前変更可）", "createBoardFailed": "tugtile ボードの作成に失敗：{0}", "mtRibbon": "marktile で編集", "mtOpenCmd": "marktile：現在のノートを編集", "mtNoFile": "先に .md ノートを開いてください", "mtBackToObsidian": "Obsidian エディタに戻る", "openInMarktile": "marktile で開く", "mtToTugtile": "tugtile ボードで開く", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "基本ボタン", "mtEssentialToolsDesc": "検索・待った・やり直し", "mtInsertToolsDesc": "表示する挿入ボタン（コード／リンク）", "mtDefaultEditor": "marktile を既定の Markdown エディタにする", "mtDefaultEditorDesc": "既定はオフ。オンにすると .md ファイルが Obsidian の標準エディタではなく marktile で開きます（ボードも同様、tugtile ボタンで移動）。反映には Obsidian の再読み込みが必要。いつでもオフにして標準エディタに戻せます。", "mtReloadRequired": "反映するには Obsidian を再読み込みしてください", "mtSettings": "marktile 設定", "mtSettingsTitle": "marktile 設定", "mtSettingsDesc": "marktile は任意の .md ノートを tile ファミリーのエディタで開きます。ツールバーに表示するボタンを選んだり（すべて外すとツールバーを完全に隠せます）、marktile を既定の Markdown エディタにできます。", "mtModePlain": "プレーン", "mtModeSeasoned": "アジツケ", "expandAllAction": "すべて展開", "collapseAllAction": "すべて折りたたむ", "expandLanesAction": "レーンを展開", "mtModeToggle": "アジツケ／プレーン切替", "mtLockToggle": "エディタをロック（読み取り専用）", "mtToc": "目次", "mtTocEmpty": "見出しなし", "edH1": "見出し 1", "edH2": "見出し 2", "edH3": "見出し 3", "edBold": "太字", "edItalic": "斜体", "edStrike": "取り消し線", "edBullet": "箇条書き", "edNumber": "番号付きリスト", "edCheck": "チェックリスト", "edQuote": "引用", "edCode": "インラインコード", "edLink": "ウィキリンク", "edDate": "日付を挿入", "edTime": "時刻を挿入", "edFind": "検索／置換", "TBL_INS_COL_L": "左に列を挿入", "TBL_INS_COL_R": "右に列を挿入", "TBL_INS_ROW_A": "上に行を挿入", "TBL_INS_ROW_B": "下に行を挿入", "TBL_DEL_COL": "列を削除", "TBL_DEL_ROW": "行を削除", "mtModeRendered": "レンダー", "mtModesPick": "表示モード", "mtModesPickDesc": "ビュー切り替えボタンが巡回するモード。最低 1 つは残ります。", "mtModesMinOne": "ビューモードは最低 1 つ残してください。", "gBlockTools": "ブロックツール", "gBlockToolsDesc": "リスト・チェック・引用・表。", "edTable": "表", "edImage": "画像を挿入", "edVideo": "動画を挿入", "edVideoPrompt": "動画 URL（YouTube／Vimeo／mp4）：", "mtSeasonedColor": "調味：カラフル配色", "mtSeasonedColorDesc": "見出し・太字・コード・リンクなどを単色アクセントではなく、それぞれの色で表示します。", "backupsAction": "バックアップ", "backupTitle": "ボードのバックアップ", "backupDesc": "tugtile はセッションごとの最初の変更前にこのボードを _tugtile-backups/ にスナップショットし、ファイルが他で編集されたら自動で再読み込みします。ミスや同期の衝突で作業を失いません。", "backupEmpty": "まだバックアップはありません。セッションごとの最初の変更前に自動で作成されます。", "backupOpen": "開く", "backupRestoreConfirm": "現在のボードをこのバックアップで置き換えますか？現在の状態は先にバックアップされるので元に戻せます。", "backupRestored": "tugtile：バックアップからボードを復元しました", "backupRestoreFailed": "tugtile：このバックアップを復元できませんでした", "safetyHeading": "あなたのデータは安全です", "backupRetentionName": "バックアップ履歴の上限", "backupRetentionDesc": "各ボードで保持するバックアップ数。超過分は古いものから削除（-1＝すべて保持）。", "familyMarktile": "marktile：姉妹エディタ", "familyMarktileDesc": "マーカーが隠れず、見出しが大きくなる Markdown エディタ。ここのカードエディタと同じエンジン・同じ操作感。", "familyTugtile": "tugtile：姉妹ボード", "familyTugtileDesc": "Markdown ノートを、引いて並べ替えるカードボードに。既存のボードも読み込めます。", "familyGet": "プラグインを見る", "familyHave": "tile ファミリーをすべて揃えています。", "keyboardHintName": "キーボード", "keyboardHint": "ヒント：カードをフォーカス（Tab かクリック）して矢印キーで移動：上下は同じレーン、左右はレーン間。"}, "ko-KR": {"appName": "태그타일", "brandSuffix": "tugtile-ing (태그타일 중)", "brandSuffixLocked": "tugtile (태그타일)", "lockToggle": "보드 잠금/해제", "lockedNotice": "보드가 잠겨 있습니다", "undoAction": "무르기", "redoAction": "다시 실행", "viewSwitchAction": "보기 전환 (보드 / 표)", "boardSettingsAction": "이 보드 설정", "openAsMarkdownAction": "마크다운으로 열기", "archiveAction": "보관함", "searchAction": "타일 검색", "emptyNoFile": "보드 .md에서 “tugtile로 열기” 명령을 사용하세요.", "fileNotFound": "파일을 찾을 수 없습니다: {0}", "searchPlaceholder": "타일 찾기", "viewBoard": "보드", "viewTable": "표", "editMarkdown": "Markdown 원본 편집", "findPlaceholder": "찾기", "replacePlaceholder": "바꿀 내용", "findPrev": "이전", "findNext": "다음", "replaceOne": "바꾸기", "replaceAll": "모두 바꾸기", "colTile": "타일", "colLane": "열", "colDate": "날짜", "colTags": "태그", "collapseExpand": "접기 / 펼치기", "laneActionsAria": "열 작업 (이름 변경 / 삽입 / 정렬 / 보관 / 삭제…)", "tileActionsAria": "추가 작업 (편집 / 보관 / 삭제…)", "relDateWrap": " ({0})", "today": "오늘", "tomorrow": "내일", "yesterday": "어제", "dayAfterTomorrow": "모레", "dayBeforeYesterday": "그저께", "daysLater": "{0}일 후", "daysAgo": "{0}일 전", "yearMonth": "{0}년 {1}월", "weekdays": ["일", "월", "화", "수", "목", "금", "토"], "edit": "편집", "duplicateTile": "타일 복제", "insertTileAbove": "위에 타일 삽입", "insertTileBelow": "아래에 타일 삽입", "splitTileMenu": "분할", "archiveTileMenu": "보관", "moveTileTop": "열 맨 위로", "moveTileBottom": "열 맨 아래로", "untitledLane": "(제목 없음)", "moveToLane": "“{0}”(으)로 이동", "deleteTileMenu": "타일 버리기", "splitNoNeed": "한 줄뿐이라 분할할 수 없습니다.", "splitDone": "{0}장의 타일로 분할했습니다", "archivedTile": "타일을 보관했습니다", "deletedTile": "타일을 버렸습니다", "deletedLane": "열을 삭제했습니다", "toastUndoBtn": "무르기", "addTileBtn": "＋ 타일 추가", "dropToArchive": "여기에 놓아 보관", "cancel": "취소", "save": "저장", "discardConfirm": "변경 사항을 취소할까요?", "editLost": "이 타일은 더 이상 존재하지 않아 편집이 저장되지 않았습니다.", "mobileSubmit": "전송", "addLaneBtn": "＋ 열 추가", "addLanePlaceholder": "열 이름　⏎ 추가", "newLane": "새 열", "newBoardName": "새 보드", "confirmDeleteLane": "이 열에 타일이 {0}장 있습니다. 열 전체를 삭제할까요?", "boardListViewOnly": "보드 보기에서 사용하세요", "archivedCompleted": "완료된 타일 {0}장을 보관했습니다", "noCompleted": "완료된 타일이 없습니다", "rename": "이름 변경", "insertLaneBefore": "앞에 열 삽입", "insertLaneAfter": "뒤에 열 삽입", "sortTitleAsc": "타일 제목 정렬 A→Z", "sortTitleDesc": "타일 제목 정렬 Z→A", "sortDate": "날짜 정렬 (가까운 순)", "sortTag": "태그 정렬", "markLaneComplete": "이 열 전체 완료 표시", "archiveLaneMenu": "이 열의 타일 모두 보관", "deleteLaneMenu": "열 삭제", "confirmArchiveLane": "이 열의 타일 {0}장을 모두 보관할까요?", "archivedLane": "이 열의 타일 {0}장을 보관했습니다", "noLaneToRestore": "tugtile: 복원할 열이 없습니다. 먼저 열을 만드세요", "externalModified": "tugtile: 이 파일이 다른 곳에서 변경되어 덮어쓰기를 막기 위해 다시 불러왔습니다(이 작업은 저장되지 않음)", "backupFailed": "tugtile: 백업에 실패하여 데이터 보호를 위해 저장을 취소했습니다", "writeFailed": "tugtile 저장 실패: {0}", "saved": "저장됨", "persistFailed": "tugtile: 저장 실패, {0}", "undoVerb": "무르기", "redoVerb": "다시 실행", "noStep": "tugtile: {0}할 단계가 없습니다", "timeTraveled": "tugtile: {0} 완료(무르기 {1} / 다시 실행 {2})", "archiveTitle": "보관함", "archiveEmpty": "보관된 타일이 없습니다.", "restore": "복원", "deleteArchived": "타일 버리기", "boardSettingsTitle": "이 보드 설정", "boardSettingsDesc": "이 보드만 변경합니다(보드 파일에 저장). 비워두면 전역 기본값을 따릅니다.", "migrateBtn": "tugtile 형식으로 업그레이드", "migrateBtnDesc": "obsidian-kanban 마커를 제거하여 이 보드를 tugtile 네이티브로 만듭니다. 일방향.", "migrateConfirm": "이 보드를 tugtile 자체 형식으로 업그레이드할까요? 이후 obsidian-kanban으로 열 수 없으며 kanban 전용 설정은 삭제됩니다.", "migrateDone": "tugtile 형식으로 업그레이드됨", "confirm": "확인", "setShowCheckboxes": "타일 체크박스 표시", "setHideCount": "열 카운트 숨기기", "setEnterBehavior": "Enter 키 동작", "setEnterBehaviorDesc": "shift-enter＝Enter로 전송(CJK 친화); enter＝Enter로 줄바꿈", "optEnterSubmit": "Enter로 전송", "optEnterNewline": "Enter로 줄바꿈", "setNewCardPos": "새 타일 위치", "optAppend": "열 맨 아래", "optPrepend": "열 맨 위", "optPrependCompact": "열 맨 위(간단)", "setRelativeDate": "상대 날짜 표시", "setRelativeDateDesc": "오늘 / 내일 / N일 후", "setDateFormat": "날짜 저장 형식", "setDateFormatDesc": "마크다운에 기록하는 형식(예: YYYY-MM-DD)", "setDateDisplay": "날짜 표시 형식", "setDateDisplayDesc": "타일에 표시되는 형식", "setDateTrigger": "날짜 트리거 문자", "setDateTriggerDesc": "기본 @", "setTimeTrigger": "시간 트리거 문자", "setTimeTriggerDesc": "기본 @@", "setLinkDaily": "날짜를 데일리 노트에 링크", "setLinkDailyDesc": "날짜를 @[[..]]로 작성해 데일리 노트에 링크", "setTagAction": "태그 클릭 동작", "setTagActionDesc": "태그를 클릭할 때의 동작: 전체 vault 검색, 또는 이 보드만 필터.", "optSearchVault": "전체 vault 검색", "optFilterBoard": "이 보드 필터", "setMoveTags": "태그를 타일 하단으로 이동", "setArchiveWithDate": "보관 시 타임스탬프 추가", "settingsTitle": "tugtile 설정", "settingsDesc": "이것은 전역 기본값이며, 각 보드의 동일한 이름 설정이 우선합니다.", "gShowCheckboxes": "타일 체크박스 표시", "gShowCheckboxesDesc": "각 타일 오른쪽 위에 체크박스 표시(- [ ] / - [x] 전환)", "gHideCount": "열 카운트 숨기기", "gHideCountDesc": "열 헤더에 타일 수를 표시하지 않음", "gResponsiveBoard": "반응형 보드 (좁은 창에서 세로 정렬)", "gResponsiveBoardDesc": "창이 좁아지면 보드를 자동으로 세로 한 줄로 재배치합니다.", "gLaneWidth": "열 너비", "gLaneWidthDesc": "각 열의 너비: 모든 열이 같은 너비로 정렬됩니다", "gTableDensity": "표 행 간격", "gTableDensityDesc": "표 각 행의 위아래 간격", "gFormatTools": "텍스트 서식 버튼", "gFormatToolsDesc": "제목, 굵게, 기울임, 취소선.", "gInsertTools": "삽입 버튼", "gInsertToolsDesc": "표시할 삽입 버튼 선택(코드/링크/날짜/시간)", "optDenseTight": "촘촘", "optDenseMid": "보통", "optDenseLoose": "넓게", "gEnterSubmit": "Enter로 전송", "gEnterSubmitDesc": "켬: Enter로 전송, Shift+Enter로 줄바꿈(CJK 친화 기본). 끔: Enter로 줄바꿈, Shift/⌘+Enter로 전송", "gPrepend": "새 타일을 맨 위에 추가", "gPrependDesc": "기본은 맨 아래에 추가; 켜면 맨 위에 추가", "gRelativeDate": "상대 날짜 표시", "gRelativeDateDesc": "타일 날짜에 “오늘 / 내일 / N일 후” 표시", "gDateDisplay": "날짜 표시 형식", "gDateDisplayDesc": "moment 형식 토큰: YYYY / MM / DD(기본 YYYY-MM-DD)", "gArchiveWithDate": "보관 시 타임스탬프 추가", "gArchiveWithDateDesc": "보관 시 제목 앞에 **YYYY-MM-DD HH:mm** 추가", "gArchiveHeading": "보관함 제목", "gArchiveHeadingDesc": "새 보관(아카이브) 섹션의 제목 문자(예: Archive, 封存).", "gDanger": "위험 작업", "gReset": "기본값으로 재설정", "gResetDesc": "위 전역 설정을 기본값으로 되돌립니다", "gResetBtn": "재설정", "cmdToggleView": "tugtile: 보드 / markdown 전환", "cmdOpenAsBoard": "tugtile로 열기", "cmdUndo": "tugtile: 무르기(실행 취소)", "cmdRedo": "tugtile: 다시 실행", "cmdCreateBoard": "tugtile: 새 보드 만들기", "cmdSearch": "tugtile: 타일 검색(Cmd/Ctrl+F에 바인딩 가능)", "cmdArchiveCompleted": "tugtile: 완료된 타일 모두 보관", "cmdConvertToBoard": "tugtile: 현재 노트를 보드로 변환", "cmdNewCard": "tugtile: 열에 새 타일", "cmdNewLane": "tugtile: 열 추가", "cmdRenameLane": "tugtile: 열 이름 변경", "createBoardHere": "여기에 tugtile 보드 만들기", "openAsBoard": "tugtile 보드로 열기", "ribbonTitle": "tugtile 보드", "ribbonNoFile": "먼저 보드 .md 파일을 여세요", "convertFailed": "tugtile 변환 실패: {0}", "boardCreated": "보드를 만들었습니다: {0}(파일 탐색기에서 이름 변경 가능)", "createBoardFailed": "tugtile 보드 생성 실패: {0}", "mtRibbon": "marktile로 편집", "mtOpenCmd": "marktile: 현재 노트 편집", "mtNoFile": ".md 노트를 먼저 여세요", "mtBackToObsidian": "Obsidian 편집기로", "openInMarktile": "marktile에서 열기", "mtToTugtile": "tugtile 보드로 열기", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "기본 버튼", "mtEssentialToolsDesc": "검색・무르기・다시 실행", "mtInsertToolsDesc": "표시할 삽입 버튼 (코드 / 링크)", "mtDefaultEditor": "marktile을 기본 Markdown 편집기로 설정", "mtDefaultEditorDesc": "기본은 꺼짐. 켜면 .md 파일이 Obsidian 기본 편집기 대신 marktile로 열립니다(보드 파일도 포함, tugtile 버튼으로 이동). 적용하려면 Obsidian을 다시 로드하세요. 언제든 꺼서 기본 편집기로 되돌릴 수 있습니다.", "mtReloadRequired": "적용하려면 Obsidian을 다시 로드하세요", "mtSettings": "marktile 설정", "mtSettingsTitle": "marktile 설정", "mtSettingsDesc": "marktile은 모든 .md 노트를 tile 패밀리 편집기로 엽니다. 도구 모음에 표시할 버튼을 선택하거나(모두 해제하면 도구 모음을 완전히 숨길 수 있음), marktile을 기본 Markdown 편집기로 설정할 수 있습니다.", "mtModePlain": "담백", "mtModeSeasoned": "양념", "expandAllAction": "모두 펼치기", "collapseAllAction": "모두 접기", "expandLanesAction": "레인 펼치기", "mtModeToggle": "양념 / 담백 전환", "mtLockToggle": "편집기 잠금(읽기 전용)", "mtToc": "목차", "mtTocEmpty": "제목 없음", "edH1": "제목 1", "edH2": "제목 2", "edH3": "제목 3", "edBold": "굵게", "edItalic": "기울임", "edStrike": "취소선", "edBullet": "글머리 목록", "edNumber": "번호 목록", "edCheck": "체크리스트", "edQuote": "인용", "edCode": "인라인 코드", "edLink": "위키링크", "edDate": "날짜 삽입", "edTime": "시간 삽입", "edFind": "찾기 / 바꾸기", "TBL_INS_COL_L": "왼쪽에 열 삽입", "TBL_INS_COL_R": "오른쪽에 열 삽입", "TBL_INS_ROW_A": "위에 행 삽입", "TBL_INS_ROW_B": "아래에 행 삽입", "TBL_DEL_COL": "열 삭제", "TBL_DEL_ROW": "행 삭제", "mtModeRendered": "렌더", "mtModesPick": "보기 모드", "mtModesPickDesc": "보기 전환 버튼이 순환하는 모드. 최소 하나는 켜져 있습니다.", "mtModesMinOne": "보기 모드는 최소 하나 남겨 두세요.", "gBlockTools": "블록 도구", "gBlockToolsDesc": "목록, 체크리스트, 인용, 표.", "edTable": "표", "edImage": "이미지 삽입", "edVideo": "동영상 삽입", "edVideoPrompt": "동영상 URL (YouTube / Vimeo / mp4):", "mtSeasonedColor": "시즈닝: 컬러 구문", "mtSeasonedColorDesc": "제목·굵게·코드·링크 등을 단일 강조색 대신 각각의 색으로 표시합니다.", "backupsAction": "백업", "backupTitle": "보드 백업", "backupDesc": "tugtile은 세션마다 첫 변경 전에 이 보드를 _tugtile-backups/에 스냅샷하고, 파일이 다른 곳에서 편집되면 자동으로 다시 불러옵니다. 실수나 동기화 충돌로 작업을 잃지 않습니다.", "backupEmpty": "아직 백업이 없습니다. 세션마다 첫 변경 전에 자동으로 만들어집니다.", "backupOpen": "열기", "backupRestoreConfirm": "현재 보드를 이 백업으로 교체할까요? 현재 상태가 먼저 백업되므로 되돌릴 수 있습니다.", "backupRestored": "tugtile: 백업에서 보드를 복원했습니다", "backupRestoreFailed": "tugtile: 이 백업을 복원할 수 없습니다", "safetyHeading": "데이터는 안전합니다", "backupRetentionName": "백업 기록 한도", "backupRetentionDesc": "보드마다 보관할 백업 수. 초과 시 오래된 것부터 삭제(-1 = 모두 보관).", "familyMarktile": "marktile: 자매 에디터", "familyMarktileDesc": "마커가 숨지 않고 제목이 커지는 Markdown 에디터. 여기 카드 에디터와 같은 엔진, 같은 느낌.", "familyTugtile": "tugtile: 자매 보드", "familyTugtileDesc": "Markdown 노트를 끌어서 재정렬하는 카드 보드로. 기존 보드도 읽습니다.", "familyGet": "플러그인 보기", "familyHave": "이미 tile 패밀리를 모두 갖추셨습니다.", "keyboardHintName": "키보드", "keyboardHint": "팁: 카드를 포커스(Tab 또는 클릭)하고 화살표 키로 이동: 위/아래는 같은 레인, 좌/우는 레인 간."}, "zh-TW": {"appName": "理牌", "brandSuffix": "tugtile-ing（理牌中）", "brandSuffixLocked": "tugtile（理牌）", "lockToggle": "鎖定／解鎖牌桌", "lockedNotice": "牌桌已鎖定", "undoAction": "悔牌（復原）", "redoAction": "重出（重做）", "viewSwitchAction": "切換檢視（牌桌／牌表）", "boardSettingsAction": "本牌桌設定", "openAsMarkdownAction": "以 markdown 開啟", "archiveAction": "牌庫（收牌區）", "searchAction": "搜尋牌", "emptyNoFile": "在某張牌桌 .md 上用指令「以 tugtile 開啟」。", "fileNotFound": "找不到檔案：{0}", "searchPlaceholder": "找牌", "viewBoard": "牌桌", "viewTable": "牌表", "editMarkdown": "編輯 Markdown 原始碼", "findPlaceholder": "尋找", "replacePlaceholder": "取代為", "findPrev": "上一個", "findNext": "下一個", "replaceOne": "取代", "replaceAll": "全部取代", "colTile": "牌", "colLane": "牌列", "colDate": "日期", "colTags": "標籤", "collapseExpand": "收合 / 展開", "laneActionsAria": "牌列動作（改名／插入／排序／收牌／棄牌…）", "tileActionsAria": "更多動作（編輯／收牌／棄牌…）", "relDateWrap": "（{0}）", "today": "今天", "tomorrow": "明天", "yesterday": "昨天", "dayAfterTomorrow": "後天", "dayBeforeYesterday": "前天", "daysLater": "{0} 天後", "daysAgo": "{0} 天前", "yearMonth": "{0} 年 {1} 月", "weekdays": ["日", "一", "二", "三", "四", "五", "六"], "edit": "編輯", "duplicateTile": "複製牌", "insertTileAbove": "在上方新增牌", "insertTileBelow": "在下方新增牌", "splitTileMenu": "拆分成多張", "archiveTileMenu": "收牌（封存）", "moveTileTop": "移到牌列頂", "moveTileBottom": "移到牌列底", "untitledLane": "(未命名)", "moveToLane": "移到「{0}」", "deleteTileMenu": "棄牌", "splitNoNeed": "只有一行，無需拆分", "splitDone": "已拆分成 {0} 張牌", "archivedTile": "已收牌（封存）", "deletedTile": "已棄牌", "deletedLane": "已刪牌列", "toastUndoBtn": "悔牌", "addTileBtn": "＋ 新增一張牌", "dropToArchive": "拖到這裡收牌", "cancel": "取消", "save": "儲存", "discardConfirm": "放棄這次的變更？", "editLost": "這張牌已不存在，編輯未儲存。", "mobileSubmit": "送出", "addLaneBtn": "＋ 新增牌列", "addLanePlaceholder": "牌列名稱　⏎ 新增", "newLane": "新牌列", "newBoardName": "新牌桌", "confirmDeleteLane": "這個牌列有 {0} 張牌，確定刪除整列？", "boardListViewOnly": "請在牌桌檢視使用", "archivedCompleted": "已收 {0} 張已完成牌", "noCompleted": "沒有已完成的牌", "rename": "改名", "insertLaneBefore": "在前面插入牌列", "insertLaneAfter": "在後面插入牌列", "sortTitleAsc": "依牌面排序 A→Z", "sortTitleDesc": "依牌面排序 Z→A", "sortDate": "依日期排序（近→遠）", "sortTag": "依標籤排序", "markLaneComplete": "標記本列全部完成", "archiveLaneMenu": "收本列所有牌", "deleteLaneMenu": "刪除牌列", "confirmArchiveLane": "把這列的 {0} 張牌全部收進牌庫？", "archivedLane": "已收本列 {0} 張牌", "noLaneToRestore": "理牌：沒有可還原到的牌列，請先建一列", "externalModified": "理牌：偵測到此檔在別處被修改，已重新載入以免覆蓋（剛才這步未寫入）", "backupFailed": "理牌：備份失敗，為保護資料已取消這次寫回", "writeFailed": "理牌寫回失敗：{0}", "saved": "已儲存", "persistFailed": "理牌：存檔失敗，{0}", "undoVerb": "悔牌", "redoVerb": "重出", "noStep": "理牌：沒有可{0}的步驟了", "timeTraveled": "理牌：已{0}（可悔牌 {1} / 可重出 {2}）", "archiveTitle": "牌庫", "archiveEmpty": "牌庫裡沒有牌。", "restore": "取回", "deleteArchived": "棄牌", "boardSettingsTitle": "本牌桌設定", "boardSettingsDesc": "只改這個牌桌（隨牌桌檔案儲存）。空白＝跟隨全域預設。", "migrateBtn": "升級成 tugtile 格式", "migrateBtnDesc": "移除 obsidian-kanban 標記，讓這個牌桌成為 tugtile 原生格式。單向不可逆。", "migrateConfirm": "要把這個牌桌升級成 tugtile 原生格式嗎？升級後將無法用 obsidian-kanban 開啟，且會清掉 kanban 專屬設定。", "migrateDone": "已升級成 tugtile 格式", "confirm": "確定", "setShowCheckboxes": "顯示牌的勾選框", "setHideCount": "隱藏牌列計數", "setEnterBehavior": "Enter 鍵行為", "setEnterBehaviorDesc": "shift-enter＝Enter 送出（CJK 友善）；enter＝Enter 換行", "optEnterSubmit": "Enter 送出", "optEnterNewline": "Enter 換行", "setNewCardPos": "新牌位置", "optAppend": "加在牌列底", "optPrepend": "加在牌列頂", "optPrependCompact": "加在牌列頂(精簡)", "setRelativeDate": "顯示相對日期", "setRelativeDateDesc": "今天 / 明天 / N 天後", "setDateFormat": "日期儲存格式", "setDateFormatDesc": "插入日期寫進 markdown 的格式（如 YYYY-MM-DD）", "setDateDisplay": "日期顯示格式", "setDateDisplayDesc": "牌上顯示的格式", "setDateTrigger": "日期觸發字元", "setDateTriggerDesc": "預設 @", "setTimeTrigger": "時間觸發字元", "setTimeTriggerDesc": "預設 @@", "setLinkDaily": "日期連每日筆記", "setLinkDailyDesc": "日期寫成 @[[..]] 連到每日筆記", "setTagAction": "點標籤行為", "setTagActionDesc": "點標籤時的動作：搜尋整個 vault，或只篩這個牌桌。", "optSearchVault": "搜整個 vault", "optFilterBoard": "篩本牌桌", "setMoveTags": "標籤移到牌底", "setArchiveWithDate": "收牌時加時間戳", "settingsTitle": "理牌設定", "settingsDesc": "這些是全域預設；個別牌桌的同名設定會優先。", "gShowCheckboxes": "顯示牌的勾選框", "gShowCheckboxesDesc": "在每張牌右上角顯示勾選框（可切換 - [ ] / - [x]）", "gHideCount": "隱藏牌列計數", "gHideCountDesc": "不在牌列標題列顯示牌數", "gResponsiveBoard": "自適應牌桌（窄面板直排）", "gResponsiveBoardDesc": "面板變窄時，牌桌自動改成單欄直向堆疊。", "gLaneWidth": "牌列寬度", "gLaneWidthDesc": "每個牌列的寬度，所有牌列等寬對齊", "gTableDensity": "牌表行距", "gTableDensityDesc": "牌表每列的上下間距", "gFormatTools": "文字格式按鈕", "gFormatToolsDesc": "標題、粗體、斜體、刪除線。", "gInsertTools": "插入按鈕", "gInsertToolsDesc": "選擇要顯示哪些插入按鈕（程式碼／連結／日期／時間）", "optDenseTight": "緊湊", "optDenseMid": "適中", "optDenseLoose": "寬鬆", "gEnterSubmit": "Enter 鍵送出", "gEnterSubmitDesc": "開：Enter 送出、Shift+Enter 換行（CJK 友善預設）。關：Enter 換行、Shift/⌘+Enter 送出", "gPrepend": "新牌加在牌列頂", "gPrependDesc": "預設加在牌列底；開啟改為加在牌列頂", "gRelativeDate": "顯示相對日期", "gRelativeDateDesc": "牌日期顯示「今天 / 明天 / N 天後」", "gDateDisplay": "日期顯示格式", "gDateDisplayDesc": "moment 風格 token：YYYY / MM / DD（預設 YYYY-MM-DD）", "gArchiveWithDate": "收牌時加時間戳", "gArchiveWithDateDesc": "收牌時在標題前加上 **YYYY-MM-DD HH:mm**", "gArchiveHeading": "牌庫標題", "gArchiveHeadingDesc": "新建牌庫（封存）區段用的標題文字（例如 Archive、封存）。", "gDanger": "危險操作", "gReset": "重設為預設值", "gResetDesc": "把上述全域設定還原成預設", "gResetBtn": "重設", "cmdToggleView": "理牌：切換牌桌 / markdown", "cmdOpenAsBoard": "以 tugtile 開啟", "cmdUndo": "理牌：悔牌（復原）", "cmdRedo": "理牌：重出（重做）", "cmdCreateBoard": "理牌：建立新牌桌", "cmdSearch": "理牌：搜尋牌（可綁 Cmd/Ctrl+F）", "cmdArchiveCompleted": "理牌：收全牌桌已完成牌", "cmdConvertToBoard": "理牌：把目前筆記轉成牌桌", "cmdNewCard": "理牌：在牌列新增一張牌", "cmdNewLane": "理牌：新增牌列", "cmdRenameLane": "理牌：改牌列名稱", "createBoardHere": "在此建立 tugtile 牌桌", "openAsBoard": "以 tugtile 牌桌開啟", "ribbonTitle": "tugtile 牌桌", "ribbonNoFile": "請先開啟一個牌桌 .md 檔", "convertFailed": "理牌轉換失敗：{0}", "boardCreated": "已建立牌桌：{0}（可在檔案總管改名）", "createBoardFailed": "理牌建立牌桌失敗：{0}", "mtRibbon": "用 marktile 編輯", "mtOpenCmd": "marktile：編輯目前筆記", "mtNoFile": "請先開啟一個 .md 筆記", "mtBackToObsidian": "回 Obsidian 編輯器", "openInMarktile": "開進 marktile", "mtToTugtile": "以 tugtile 牌桌開啟", "mtBrand": "marktile-ing", "mtBrandLocked": "marktile", "mtEssentialTools": "基本按鈕", "mtEssentialToolsDesc": "搜尋、復原、重做", "mtInsertToolsDesc": "要顯示哪些插入按鈕（程式碼／連結）", "mtDefaultEditor": "將 marktile 設為預設 Markdown 編輯器", "mtDefaultEditorDesc": "預設關閉。開啟後 .md 檔會用 marktile 開啟，而非 Obsidian 內建編輯器（看板檔也是，可用 tugtile 按鈕跳過去）。需重新載入 Obsidian 生效；隨時可關閉以還原原生編輯器。", "mtReloadRequired": "請重新載入 Obsidian 以生效", "mtSettings": "marktile 設定", "mtSettingsTitle": "marktile 設定", "mtSettingsDesc": "marktile 用 tile 家族的編輯器打開任何 .md 筆記。在這裡選擇工具列要顯示哪些按鈕（全部取消即可完全隱藏工具列），或將 marktile 設為預設的 Markdown 編輯器。", "mtModePlain": "原味", "mtModeSeasoned": "調味", "expandAllAction": "全展開", "collapseAllAction": "全收起", "expandLanesAction": "展開牌列", "mtModeToggle": "切換 調味／原味", "mtLockToggle": "鎖定編輯器（唯讀）", "mtToc": "目錄", "mtTocEmpty": "沒有標題", "edH1": "標題 1", "edH2": "標題 2", "edH3": "標題 3", "edBold": "粗體", "edItalic": "斜體", "edStrike": "刪除線", "edBullet": "項目清單", "edNumber": "編號清單", "edCheck": "核取清單", "edQuote": "引言", "edCode": "行內程式碼", "edLink": "雙向連結", "edDate": "插入日期", "edTime": "插入時間", "edFind": "尋找／取代", "TBL_INS_COL_L": "在左方插入欄", "TBL_INS_COL_R": "在右方插入欄", "TBL_INS_ROW_A": "在上方插入列", "TBL_INS_ROW_B": "在下方插入列", "TBL_DEL_COL": "刪除欄", "TBL_DEL_ROW": "刪除列", "mtModeRendered": "渲染", "mtModesPick": "檢視模式", "mtModesPickDesc": "檢視循環按鈕會輪替哪些模式。至少保留一個。", "mtModesMinOne": "至少保留一個檢視模式。", "gBlockTools": "區塊工具", "gBlockToolsDesc": "清單、核取、引用、表格。", "edTable": "表格", "edImage": "插入圖片", "edVideo": "插入影片", "edVideoPrompt": "影片網址（YouTube／Vimeo／mp4）：", "mtSeasonedColor": "調味：彩色語法染色", "mtSeasonedColorDesc": "標題、粗體、行內碼、連結等各用自己的顏色，而非單一強調色。", "backupsAction": "備份", "backupTitle": "牌桌備份", "backupDesc": "tugtile 在每個工作階段第一次改動前，會把這張牌桌快照到 _tugtile-backups/，並在檔案被別處編輯時自動重載，一次手殘或同步衝突都不會弄丟你的東西。", "backupEmpty": "還沒有備份。每個工作階段第一次改動前會自動建一份。", "backupOpen": "開啟", "backupRestoreConfirm": "用這份備份取代目前的牌桌？會先備份目前狀態，所以可以還原回來。", "backupRestored": "理牌：已從備份還原牌桌", "backupRestoreFailed": "理牌：無法還原這份備份", "safetyHeading": "你的資料是安全的", "backupRetentionName": "版本記錄上限", "backupRetentionDesc": "每張牌桌最多保留幾份備份，超過自動刪最舊（-1＝全部保留）。", "familyMarktile": "marktile：同源編輯器", "familyMarktileDesc": "標記永不隱藏、標題會長大的 Markdown 編輯器，跟這裡的卡片編輯器同一個引擎、同一種手感。", "familyTugtile": "tugtile：同源牌桌", "familyTugtileDesc": "把你的 Markdown 筆記變成可以「拉」著重排的牌桌，還能讀你既有的牌桌。", "familyGet": "查看外掛", "familyHave": "你已經擁有完整的 tile 家族了。", "keyboardHintName": "鍵盤", "keyboardHint": "小技巧：聚焦一張卡片（Tab 或點一下），用方向鍵搬動它：上下在同一牌列、左右跨牌列。"}};   // i18n strings are moved to i18n/*.json and injected during build by build.sh (translators only need to edit JSON)

function t(key, ...args) {
  let s = (TR[LOCALE] && TR[LOCALE][key]);
  if (s == null) s = TR['en-US'] && TR['en-US'][key];
  if (s == null) return key;
  if (typeof s === 'string' && args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] != null ? args[+i] : m));
  return s;
}
/* ===================== /i18n ===================== */

const LANE_WIDTHS = { narrow: 260, medium: 300, wide: 360 };   // Lane width presets (px)
const TABLE_PADS = { narrow: 5, medium: 9, wide: 14 };          // Table row vertical-padding presets (px) — "table density"
// Shared touch-drag tuning for EVERY draggable (lanes + tiles): long-press to start (delay), and tolerate a little
// finger tremor first (touchStartThreshold) so a tap/long-press to rename a lane isn't hijacked into a drag.
// One source → lanes and tiles always feel the same. (TOC drag in the editor core carries its own copy.)
const DRAG_TOUCH = { delay: 180, delayOnTouchOnly: true, touchStartThreshold: 8, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4 };
// Full-screen editor toolbar buttons (order + groups). 'sep' marks a group divider. Each can be toggled in settings (default all on); settings show the glyph as the label.
// build injects packages/core/editor-core.js (the shared editor core) at the next line:
/* tile-family shared editor core — the SINGLE source of the editor engine used by BOTH plugins.
   Extracted from tugtile's plugin.src.js (the former //#core-start/#core-end blocks). The builds
   inject this file at each plugin's core-inline marker. It uses Obsidian element helpers / setIcon /
   Platform / Modal, which both Obsidian-plugin consumers provide (de-Obsidian-ifying for the web host is a
   later, separate step). EDITOR_TOOLS + escHtml + highlighters + listContinuation + tabEdit +
   tocHeadings + moveSection + mountEditor + TileEditModal. */

const EDITOR_TOOLS = [
  // fixed: always shown, not user-toggleable (essentials). tip = i18n key for the hover/aria label.
  { key: 'search', icon: 'search', fixed: true, tip: 'edFind' }, { key: 'undo', icon: 'undo', fixed: true, tip: 'undoAction' }, { key: 'redo', icon: 'redo', fixed: true, tip: 'redoAction' }, 'sep',
  // icons verified present in Obsidian's bundled Lucide subset (not all of Lucide ships); g = text fallback when no icon
  { key: 'h1', g: 'H1', icon: 'heading-1', cat: 'format', tip: 'edH1' }, { key: 'h2', g: 'H2', icon: 'heading-2', cat: 'format', tip: 'edH2' }, { key: 'h3', g: 'H3', icon: 'heading-3', cat: 'format', tip: 'edH3' }, 'sep',
  { key: 'bold', g: 'B', icon: 'bold', cat: 'format', tip: 'edBold' }, { key: 'italic', g: 'I', icon: 'italic', cat: 'format', tip: 'edItalic' }, { key: 'strike', g: 'S', icon: 'strikethrough', cat: 'format', tip: 'edStrike' }, 'rowbreak',   // phone: wrap to a third toolbar row here (desktop treats it as a separator)
  // block tools (lists / quote / table) — split out of 'format' (which is now just headings + inline marks)
  { key: 'bullet', g: '•', icon: 'list', cat: 'block', tip: 'edBullet' }, { key: 'number', g: '1.', icon: 'list-ordered', cat: 'block', tip: 'edNumber' }, { key: 'check', g: '☑', icon: 'list-checks', cat: 'block', tip: 'edCheck' }, { key: 'quote', g: '❝', icon: 'text-quote', cat: 'block', tip: 'edQuote' }, { key: 'table', g: '⊞', icon: 'table', cat: 'block', tip: 'edTable' }, 'sep',
  { key: 'code', g: '</>', icon: 'code', cat: 'insert', tip: 'edCode' }, { key: 'link', g: '[[ ]]', icon: 'link', cat: 'insert', tip: 'edLink' },
  // image/video: capability lives in the core, NOT injected per-surface. Each host wires the platform seam via
  // opts.pickImage / opts.pickVideo (Obsidian: vault save / web: upload) — `needs` hides the button when unwired.
  { key: 'image', g: 'IMG', icon: 'image', cat: 'insert', tip: 'edImage', needs: 'pickImage' }, { key: 'video', g: 'VID', icon: 'video', cat: 'insert', tip: 'edVideo', needs: 'pickVideo' }, 'sep',
  { key: 'date', g: '@', icon: 'calendar', cat: 'insert', tip: 'edDate' }, { key: 'time', g: '@@', icon: 'clock', cat: 'insert', tip: 'edTime' },
];

// Centered modal editor for cards: large centered card, darkened background, virtual keyboard adjusts modal container, saves changes on close
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// tile-cssmd — the "render markdown with markers HIDDEN via CSS" primitive, extracted as a
// SHARED, zero-dependency, render-only module. The technique (born in marktile's "Seasoned"
// renderer, later reused by another host's inline bar): wrap each markdown MARKER in a hidden span
// (`<prefix>-mk`, hidden by `.<prefix>-mk{display:none}`) and the CONTENT in an EFFECT span
// (`<prefix>-b` bold / `<prefix>-i` italic / `<prefix>-code`). The rendered text shows the
// effect while the raw markers stay invisible-but-present in the DOM — so the text↔DOM round
// trip (getText reads textContent, markers included) stays exact, and a host that opts in
// hides the markers via one CSS rule.
//
// This is the INLINE subset of the family's `highlightLineParts` (editor-core.js), made
// namespace-neutral: the tile plugins use `tg-*`, another host uses `gd-*`, a preview
// bar could use `gp-*` — all from ONE source. The faithful superset of:
//   • editor-core.js highlightLineParts inline marks (tg-b / tg-i / tg-code) — markers in tg-mk
//   • another host's inline renderer (gd-b / gd-i / gd-code) — markers in gd-mk
// Covered marks: **bold**, *italic*, `code`. (Block-level marks — headings, lists, quotes,
// links, tags, dates, strike, tables — stay in the full editor core; this is the inline-only,
// host-agnostic primitive both bars actually need.)
//
// SECURITY: text content is HTML-escaped here, so a raw, untrusted markdown STRING is safe to
// pass directly. (An earlier host copy required callers to pre-escape — `inlineMd(esc(...))`.
// This module escapes for you, so `renderInlineMd(rawString)` is XSS-safe by itself. Passing
// already-escaped text still works: escaping is idempotent for the entities we emit.)

const ESC_RE = /[&<>]/g;
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

// Escape the HTML-significant chars in text content. Matches editor-core.js `escHtml`
// (& < >). Quotes aren't escaped because content is only ever placed in a text position,
// never inside an attribute value.

// Emit `<span class="<prefix>-mk">…</span>` — the hidden-marker wrapper. `marker` is a literal
// markdown delimiter (`**` / `*` / `` ` ``); it contains no HTML-significant chars, but we
// escape defensively so the contract ("everything that lands in the DOM went through escaping")
// holds unconditionally.
function mk(prefix, marker) {
  return '<span class="' + prefix + '-mk">' + escHtml(marker) + '</span>';
}

// ── The individual marker PASSES, each operating on ALREADY-ESCAPED text ──────────────────────
// These are the raw `.replace()` passes, factored out so a caller that ALREADY escaped (and may
// have injected other markup first — e.g. editor-core.js's highlightLineParts, which wraps block
// markers BEFORE the inline ones, with its strike pass running BETWEEN bold and code) can splice
// them into its own chain and stay BYTE-IDENTICAL. `renderInlineMd` is the escape-then-both-passes
// convenience wrapper most hosts want; these are the parts it's built from.
//
// CONTRACT: input is already HTML-escaped (run escHtml first). They do NOT escape — splicing them
// mid-chain must not double-encode. Pure, DOM-free.

// **bold** / *italic* (asterisks, which work intraword) and __bold__ / _italic_ (underscores) over
// escaped text. Bold wins the alternation; the single-delimiter italic branch needs a non-space
// right after the opener so "a * b" / "a _ b" stay literal.
//
// 🔴 Underscores follow CommonMark's INTRAWORD rule — an opening or closing `_` may not touch an
// alphanumeric — so `snake_case`, `file_name` and `a_b_c` stay literal and only asterisks emphasise
// mid-word. Without that rule a page rendering ordinary prose grew bare underscores wherever an
// identifier appeared, which is the bug this arrived from.
function markBoldItalic(escaped, prefix) {
  const p = prefix || 'tg';
  const RE = /(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*?\*|(?<![A-Za-z0-9])__[^_\n]+__(?![A-Za-z0-9])|(?<![A-Za-z0-9])_[^_\s][^_\n]*?_(?![A-Za-z0-9]))/g;
  return String(escaped).replace(RE, (m) => {
    const marker = m.startsWith('**') ? '**' : m.startsWith('__') ? '__' : m[0] === '*' ? '*' : '_';
    const cls = (marker === '**' || marker === '__') ? p + '-b' : p + '-i';
    const inner = m.slice(marker.length, m.length - marker.length);
    return '<span class="' + cls + '">' + mk(p, marker) + inner + mk(p, marker) + '</span>';
  });
}

// `code` over escaped text — single backticks, no newline inside.
function markCode(escaped, prefix) {
  const p = prefix || 'tg';
  return String(escaped).replace(/(`[^`\n]+`)/g, (m) => {
    const inner = m.slice(1, -1);
    return '<span class="' + p + '-code">' + mk(p, '`') + inner + mk(p, '`') + '</span>';
  });
}

// Render an INLINE markdown string into HTML with markers wrapped in hidden `*-mk` spans and
// content wrapped in effect spans. Pure, DOM-free, zero-dependency.
//
//   renderInlineMd(text, { prefix = 'tg' } = {})  →  HTML string
//
//   text    raw inline markdown (a single line / fragment). HTML-escaped internally → XSS-safe.
//   prefix  class namespace, default 'tg'. tile → 'tg', another host → 'gd', preview → 'gp'.
//
// Behaviour (faithful to editor-core.js highlightLineParts inline marks):
//   **bold**   → <span class="<p>-b"><span class="<p>-mk">**</span>bold<span class="<p>-mk">**</span></span>
//   *italic*   → <span class="<p>-i">…*…italic…*…</span>   (single * needs a non-space after it,
//                                                            so "a * b" is NOT italicised)
//   `code`     → <span class="<p>-code">…`…code…`…</span>
//   **bold** wins the alternation over *italic*; `code` is a separate pass. Content INSIDE the
//   marks is plain text (escaped) — no nested re-parsing, matching the source renderers exactly.
function renderInlineMd(text, opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  // Escape FIRST (whole string), then run the marker passes over escaped text — same order as
  // editor-core.js (escHtml(line).replace(...)). The markers **, *, ` are unaffected by escaping.
  return markCode(markBoldItalic(escHtml(text), prefix), prefix);
}

// The CSS contract. Returns the stylesheet text a host must include for the technique to work:
//   • `.<prefix>-mk{display:none}` — HIDES the raw markers (the whole point).
//   • `.<prefix>-b{font-weight:700}` / `.<prefix>-i{font-style:italic}` — the bold/italic effects.
//   • `.<prefix>-code{…}` — monospace inline code. Colours are intentionally LEFT to the host
//     (another host tints code teal, marktile uses its own accent); this primitive ships only
//     the structural rules so consumers stay in control of their palette. Pass
//     `{ scope: '.gd-answer' }` to prefix every selector (e.g. only hide markers inside answers),
//     mirroring another host's `.gd-answer .gd-mk{display:none}`.
function cssContract(opts) {
  const prefix = (opts && opts.prefix) || 'tg';
  const scope = (opts && opts.scope) ? opts.scope + ' ' : '';
  return (
    scope + '.' + prefix + '-mk{display:none}' +
    scope + '.' + prefix + '-b{font-weight:700}' +
    scope + '.' + prefix + '-i{font-style:italic}' +
    scope + '.' + prefix + '-code{font-family:ui-monospace,Menlo,monospace;font-size:0.92em;border-radius:3px;padding:0 3px}'
  );
}


// Synchronized syntax highlighter: renders raw markdown styling (bold, headings, lists, blockquotes, tags, links, dates).
// Modifies only font weights and colors (maintains font size) to match the textarea line-height, ensuring perfect layout alignment (crucial for this design).
// Highlights ONE markdown line into { cls, inner } for a <div class="tg-line"> block. Markers are KEPT
// (literal '## ' stays visible); heading lines just carry a level class so CSS can size them up. An empty
// line uses <br> (textContent '') so the text<->DOM round-trip stays exact. Shared by the full render and
// the in-place single-line re-highlight (so both produce byte-identical DOM).
function highlightLineParts(line) {
  let cls = 'tg-line';
  // CommonMark: a heading counts at line start, after ≤3 leading spaces, OR inside a list item. hm[1] swallows the
  // optional indent + bullet/checkbox prefix so `- ### x` / `- [ ] ### x` / `  ### x` all size+colour as headings;
  // hm[2] is the # run (→ level). It's ADDITIVE with tg-li/tg-task — a heading can also be a list/task line.
  const hm = /^(\s*(?:[-*]\s(?:\[[ xX]\]\s)?)?)(#{1,6})\s/.exec(line);
  if (hm) cls += ' tg-h tg-h' + hm[2].length;
  if (/^>\s?/.test(line)) cls += ' tg-quote';
  else if (/^\s*[-*]\s/.test(line)) cls += ' tg-li';
  // Each syntax marker (## , &gt; , - , [ ], **, *, ~~, `, [[ ]], @{}) is wrapped in its own <span class="tg-mk">
  // so a host can hide JUST the markers via CSS (.tugtile-preview .tg-mk{display:none}) while the styling stays —
  // the basis for a marker-free preview look. tg-mk is transparent to the text round-trip (getText reads
  // textContent, which still includes the marker chars). The Obsidian plugins never add .tugtile-preview, so
  // markers stay visible there (their 調味/原味 cycle is unchanged); only a host that opts in hides them. escHtml
  // has already turned a leading > into &gt; (the quote marker), so match that form.
  // Block-level markers first (headings / quote / checkbox / bullet — these STAY in the core;
  // they're line-anchored and outside cssmd's inline-only scope).
  const blocks = escHtml(line)
    .replace(/^(\s*(?:[-*]\s(?:\[[ xX]\]\s)?)?)(#{1,6}\s)/, (m, pre, hashes) => pre + '<span class="tg-mk">' + hashes + '</span>')   // heading marker — wraps only the # run, leaving any indent/bullet/checkbox prefix for the rules below to wrap
    .replace(/^(&gt;\s?)/, '<span class="tg-mk">$1</span>')   // blockquote marker
    .replace(/^(\s*[-*]\s)(\[[ xX]\])/, (m, p, box) => '<span class="tg-mk">' + p + '</span><span class="tg-check' + (/[xX]/.test(box) ? ' tg-check-done' : '') + '"><span class="tg-mk">' + box + '</span></span>')
    .replace(/^(\s*[-*]\s)/, '<span class="tg-mk">$1</span>');   // plain bullet (heading/quote/checkbox lines already start with a <span>, so this won't match them)
  // Inline **bold** / *italic* — DELEGATED to the shared cssmd primitive (markBoldItalic), the single
  // source for this mark. Runs over the already-escaped, block-marked text; byte-identical to the former
  // inline `.replace()`. tg-* prefix keeps the plugins' existing class names. (`code` follows strike, below.)
  const h = markCode(
    markBoldItalic(blocks, 'tg')
    .replace(/(~~[^~\n]+~~)/g, (m) => '<span class="tg-strike"><span class="tg-mk">~~</span>' + m.slice(2, -2) + '<span class="tg-mk">~~</span></span>'),
    'tg')   // inline `code` — also DELEGATED to cssmd (markCode); kept AFTER strike to preserve the original pass order
    .replace(/(\[\[[^\]\n]+\]\])/g, (m) => '<span class="tg-link"><span class="tg-mk">[[</span>' + m.slice(2, -2) + '<span class="tg-mk">]]</span></span>')
    .replace(/(@@?\{)([^}\n]*)(\})/g, (m, op, inner, cl) => '<span class="tg-date"><span class="tg-mk">' + op + '</span>' + inner + '<span class="tg-mk">' + cl + '</span></span>')
    .replace(/(^|[^&\w])(#[^\s#<&]+)/g, '$1<span class="tg-tag">$2</span>')
    .replace(/\t/g, '<span class="tg-tab">\t</span>');   // wrap each literal tab LAST (after the line-start regexes) so CSS can mark tab-vs-space; span is transparent to the text round-trip
  if (/^\s*[-*]\s\[[ xX]\]/.test(line)) cls += ' tg-task' + (/^\s*[-*]\s\[[xX]\]/.test(line) ? ' tg-task-done' : '');
  return { cls: cls, inner: (h || '<br>') };
}
// Renders the whole markdown source into per-line <div> blocks for the contenteditable editor.
function highlightMarkdown(text) {
  const lines = (text === '' ? [''] : text.split('\n'));
  return lines.map((line) => { const p = highlightLineParts(line); return '<div class="' + p.cls + '">' + p.inner + '</div>'; }).join('');
}

// Smart-Enter list continuation (pure, so it's unit-testable without a DOM). Given the full text and a caret
// offset, returns the new { text, caret } when the caret line is a list item (- / * / 1. / - [ ]), or null
// when it isn't (so the caller lets the native newline happen). A list item that's empty past its marker
// exits the list (marker removed). Ordered markers increment; checkbox items continue UNCHECKED.
function listContinuation(v, s) {
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', s); if (le < 0) le = v.length;
  const line = v.slice(ls, le);
  let prefix = null, contentStart = 0;
  const mu = /^(\s*)([-*])\s+(\[[ xX]\]\s+)?/.exec(line);
  if (mu) { contentStart = mu[0].length; prefix = mu[1] + mu[2] + ' ' + (mu[3] ? '[ ] ' : ''); }
  else { const mo = /^(\s*)(\d+)([.)])\s+/.exec(line); if (mo) { contentStart = mo[0].length; prefix = mo[1] + (parseInt(mo[2], 10) + 1) + mo[3] + ' '; } }
  if (prefix === null) return null;
  if (line.slice(contentStart).trim() === '') return { text: v.slice(0, ls) + v.slice(le), caret: ls };   // empty item → exit the list
  return { text: v.slice(0, s) + '\n' + prefix + v.slice(s), caret: s + 1 + prefix.length };               // continue the list
}

// Re-sequence contiguous top-level ordered-list blocks so they read 1,2,3… A markdown renderer renumbers
// regardless of the literal digits, but marktile SHOWS the markers — so deleting "2." should make the old
// "3." become "2.". Pure (unit-testable) and, for single-digit lists, caret-stable (a renumbered marker is
// the same width). A blank or non-ordered line ends a block; indented/nested ordered lists are left alone.
// Returns the SAME string when already sequential, so callers can no-op on identity (the common case).
function renumberLists(v) {
  const lines = v.split('\n');
  let n = 0, changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d+)([.)])(\s)/.exec(lines[i]);
    if (m) { n++; const want = n + m[2] + m[3]; if (m[0] !== want) { lines[i] = want + lines[i].slice(m[0].length); changed = true; } }
    else if (/^[ \t]+\S/.test(lines[i])) continue;   // indented continuation / nested list → part of the current item, leave the top-level counter alone
    else n = 0;   // blank / non-indented non-ordered line breaks the block → next ordered run restarts at 1
  }
  return changed ? lines.join('\n') : v;
}

// Tab inserts a literal tab at the caret (replacing any selection); Shift+Tab removes one tab immediately
// before a collapsed caret. Tugtile's tile structure is tab-indented (serializeTile re-adds it on write),
// so being able to type a real tab matters when editing a raw board file in marktile. Pure → unit-tested.
function tabEdit(v, s, e, outdent) {
  if (outdent) {
    if (s === e && s > 0 && v[s - 1] === '\t') return { text: v.slice(0, s - 1) + v.slice(s), caret: s - 1 };
    return null;   // nothing to outdent
  }
  return { text: v.slice(0, s) + '\t' + v.slice(e), caret: s + 1 };
}

// Table-of-contents model (pure → unit-tested). Scans markdown for H1–H3 headings OUTSIDE fenced code blocks,
// returning { level, text, line } per heading. `line` is the 0-based source line index, which maps 1:1 to the
// editor's .tg-line divs (highlightMarkdown emits one div per line) so the consumer can scroll straight to it.
function tocHeadings(text) {
  const lines = String(text).split('\n');
  const out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }   // a fence line toggles in/out of code (its own # are not headings)
    if (fence) continue;
    const m = /^(#{1,3})\s+(.*)$/.exec(lines[i]);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  }
  return out;
}

// Drag-reorder a TOC section (pure → unit-tested). oldIndex/newIndex are heading positions in tocHeadings()
// order (= SortableJS evt.oldIndex/newIndex). A "section" = the heading line through everything up to the next
// heading of EQUAL-OR-HIGHER level (so dragging an H1 carries its H2/H3 children; level B: levels never change).
// Moving down lands it after the target's whole section; moving up lands it before the target.
function moveSection(text, oldIndex, newIndex) {
  if (oldIndex === newIndex) return text;
  const lines = String(text).split('\n');
  const heads = tocHeadings(text);
  const n = heads.length;
  if (oldIndex < 0 || oldIndex >= n || newIndex < 0 || newIndex >= n) return text;
  const sectionEnd = (idx) => { const lv = heads[idx].level; for (let j = idx + 1; j < n; j++) if (heads[j].level <= lv) return heads[j].line; return lines.length; };
  const start = heads[oldIndex].line, end = sectionEnd(oldIndex);
  const block = lines.slice(start, end);
  const insertAt = (newIndex > oldIndex) ? sectionEnd(newIndex) : heads[newIndex].line;   // after target's section (down) / before target (up)
  const rest = lines.slice(0, start).concat(lines.slice(end));
  const ins = (insertAt >= end) ? insertAt - block.length : insertAt;   // shift left if the removed block sat before the insertion point
  return rest.slice(0, ins).concat(block, rest.slice(ins)).join('\n');
}

// Builds the reusable contenteditable editor into a container; returns a controller. Hosted by the modal
// (kanban cards) and by marktile's file view (standalone .md). opts: { text, onCancel?, onSave?,
// onSubmit?, onEscape?, onChange? }. host = the board view or a minimal file host (see interface above).
function mountEditor(contentEl, opts, host) {
  const orig = opts.text || '';
    contentEl.empty(); contentEl.addClass('tugtile-edit-modal');

    // Title bar: Cancel (✕) on the left, tool actions in the center, Save (✓) on the right (positioned at the top to avoid virtual keyboard occlusion)
    const bar = contentEl.createDiv({ cls: 'tugtile-ed-bar' });
    // Virtual keyboard workaround: call preventDefault on mousedown/pointerdown to block focus transfer.
    // This keeps the keyboard open, prevents viewport reflows, and ensures the tap action is registered properly.
    // The textarea retains focus and values during execution before closing. This technique is verified and reused in tbtn shortcut buttons.
    const tap = (el, fn) => {
      el.addEventListener('mousedown', (e) => e.preventDefault());                                  // Prevents stealing focus from the textarea (mouse/synthetic events)
      el.addEventListener('pointerdown', (e) => e.preventDefault());                                // Touch/stylus: same as above (blocks focus transfer only, allows scrolling)
      el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });  // Touch: triggers immediately + retains focus + blocks synthetic click
      el.addEventListener('click', fn);                                                             // Mouse/desktop click
    };
    if (opts.onToc) { const tc = bar.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-toc' }); setIcon(tc.createSpan(), 'list-tree'); tc.setAttribute('aria-label', t('mtToc')); tap(tc, opts.onToc); }   // TOC toggle — sits in the ✕'s left slot; only when the host wants it (marktile passes onToc; tugtile's card modal doesn't)
    if (opts.onCancel) { const x = bar.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-x' }); setIcon(x.createSpan(), 'x'); x.setAttribute('aria-label', t('cancel')); tap(x, opts.onCancel); }   // ✕ — Lucide icon (matches the toolbar), span-nested for iPad; only when the host wants a cancel affordance (modal)
    const tools = bar.createDiv({ cls: 'tugtile-ed-tools' });
    if (opts.onSave) { const ok = bar.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-ok' }); setIcon(ok.createSpan(), 'check'); ok.setAttribute('aria-label', t('save')); tap(ok, opts.onSave); }   // ✓ — Lucide check; only for the modal (the file view autosaves)
    // Phone: split the toolbar — the top bar keeps the essentials (search/undo/redo, centered between ✕ ✓),
    // the format/insert tools drop to a second row below so the cramped phone bar isn't a long scroll.
    const twoRow = Platform.isPhone;
    // Phone: two rows. Top = the bar itself (✕ [undo·redo·headings·bold/italic/strike] ✓). Bottom = tools2
    // (search + lists/quote/code/link/date/time). The dedicated essentials bar is gone — everything moved up.
    const tools2 = twoRow ? contentEl.createDiv({ cls: 'tugtile-ed-tools2' }) : null;

    // Editor body: a single contenteditable surface. A <textarea> can only carry one uniform font, so it
    // can never size a heading line up. contenteditable can — each line keeps its literal markdown ('## ')
    // AND renders bigger (no Obsidian-style concealment). The visible text IS the editable text (one layer),
    // so the caret needs no overlay alignment. A scroll wrapper owns scrolling so touch-drag works unfocused.
    const scroll = contentEl.createDiv({ cls: 'tugtile-ed-scroll' });
    const ed = scroll.createDiv({ cls: 'tugtile-ed tugtile-ed-rich', attr: { contenteditable: 'true', spellcheck: 'false', autocapitalize: 'off' } });

    // --- Text <-> DOM model: each line is a top-level <div class="tg-line">; an empty line is <div><br></div>. ---
    const textOfLine = (d) => (d ? d.textContent : '');
    const getText = () => {
      const kids = ed.childNodes;
      let allDiv = kids.length > 0;
      for (const n of kids) { if (!(n.nodeType === 1 && n.tagName === 'DIV')) { allDiv = false; break; } }
      if (allDiv) return Array.from(kids).map((d) => d.textContent).join('\n');
      // Transient fallback (right after a native keystroke, before re-highlight normalizes the DOM back to clean line divs)
      let out = '';
      const walk = (n) => {
        if (n.nodeType === 3) { out += n.nodeValue; return; }
        if (n.tagName === 'BR') { out += '\n'; return; }
        if ((n.tagName === 'DIV' || n.tagName === 'P') && out && !out.endsWith('\n')) out += '\n';
        for (const ch of n.childNodes) walk(ch);
      };
      for (const n of kids) walk(n);
      return out.replace(/\u200b/g, '');
    };
    let lineCount = 0;
    const render = (text) => { ed.innerHTML = highlightMarkdown(text); lineCount = ed.children.length; };

    // --- Caret <-> character offset, so toolbar ops / find-replace / undo can address the document linearly ---
    const charsBeforeInLine = (lineEl, node, off) => {
      if (node === lineEl) { let c = 0; for (let i = 0; i < off; i++) c += (lineEl.childNodes[i].textContent || '').length; return c; }
      let count = 0, done = false;
      const walk = (n) => {
        if (done) return;
        if (n === node) { count += off; done = true; return; }
        if (n.nodeType === 3) { count += n.nodeValue.length; return; }
        for (const ch of n.childNodes) { walk(ch); if (done) return; }
      };
      walk(lineEl);
      return count;
    };
    const offsetAt = (node, off) => {
      const lines = Array.from(ed.children);
      if (node === ed) { let t = 0; for (let i = 0; i < off; i++) t += textOfLine(lines[i]).length + 1; return t; }
      let lineEl = node; while (lineEl && lineEl.parentNode !== ed) lineEl = lineEl.parentNode;
      const idx = lines.indexOf(lineEl); if (idx < 0) return 0;
      let t = 0; for (let i = 0; i < idx; i++) t += textOfLine(lines[i]).length + 1;
      return t + charsBeforeInLine(lineEl, node, off);
    };
    const locateInLine = (lineEl, within) => {
      let remaining = within, res = null;
      const walk = (n) => {
        if (res) return;
        if (n.nodeType === 3) { const L = n.nodeValue.length; if (remaining <= L) { res = { node: n, off: remaining }; return; } remaining -= L; return; }
        for (const ch of n.childNodes) { walk(ch); if (res) return; }
      };
      walk(lineEl);
      return res || { node: lineEl, off: 0 };
    };
    const locate = (target) => {
      const lines = Array.from(ed.children); let acc = 0;
      for (let i = 0; i < lines.length; i++) { const len = textOfLine(lines[i]).length; if (target <= acc + len) return locateInLine(lines[i], target - acc); acc += len + 1; }
      const last = lines[lines.length - 1];
      return last ? locateInLine(last, textOfLine(last).length) : { node: ed, off: 0 };
    };
    let lastSel = { start: 0, end: 0 };
    const readSel = () => {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) return null;
      const r = s.getRangeAt(0);
      if (!ed.contains(r.startContainer)) return null;
      return { start: offsetAt(r.startContainer, r.startOffset), end: offsetAt(r.endContainer, r.endOffset) };
    };
    const sel = () => readSel() || lastSel;
    const setSel = (s, e) => {
      const a = locate(s), b = locate(e === undefined ? s : e);
      const r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, b.off);
      const ws = window.getSelection(); ws.removeAllRanges(); ws.addRange(r);
      lastSel = { start: s, end: (e === undefined ? s : e) };
    };
    ['keyup', 'mouseup', 'touchend'].forEach((ev) => ed.addEventListener(ev, () => { const r = readSel(); if (r) lastSel = r; }));

    // --- Undo / redo: our own snapshot stack (innerHTML rebuilds wipe the browser's native undo history) ---
    let hist = [], hi = -1;
    const pushHist = () => {
      const snap = { v: getText(), s: (readSel() || lastSel) };
      if (hi >= 0 && hist[hi].v === snap.v) { hist[hi].s = snap.s; return; }
      const seeded = hi >= 0;   // false only for the very first (seed) snapshot on mount
      hist = hist.slice(0, hi + 1); hist.push(snap); if (hist.length > 200) hist.shift(); hi = hist.length - 1;
      if (seeded && opts.onChange) opts.onChange();   // notify the host (marktile autosave) only for real edits, not the initial mount seed (B3)
    };
    const restore = (snap) => { render(snap.v); setSel(snap.s.start, snap.s.end); ed.focus(); };

    // --- Re-highlight, caret-preserving. Skipped while an IME is composing so CJK input is never interrupted. ---
    let composing = false, syncT = null;
    const rehighlight = () => { const r = readSel() || lastSel; render(getText()); setSel(r.start, r.end); };
    // Fast path: re-highlight ONLY the caret's line in place (no whole-document rebuild). Returns false —
    // forcing a full rehighlight — whenever the structure changed (line added/removed, content merged, or a
    // ranged selection), so the worst case is exactly the old behavior.
    const rehighlightLine = () => {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) return false;
      const r = s.getRangeAt(0);
      if (!r.collapsed || !ed.contains(r.startContainer)) return false;
      if (ed.children.length !== lineCount) return false;
      let lineEl = r.startContainer; while (lineEl && lineEl.parentNode !== ed) lineEl = lineEl.parentNode;
      if (!lineEl || lineEl.parentNode !== ed) return false;
      const text = lineEl.textContent;
      if (text.indexOf('\n') >= 0) return false;
      const within = charsBeforeInLine(lineEl, r.startContainer, r.startOffset);
      const p = highlightLineParts(text);
      lineEl.className = p.cls; lineEl.innerHTML = p.inner;
      const loc = locateInLine(lineEl, within);
      const nr = document.createRange(); nr.setStart(loc.node, loc.off); nr.collapse(true);
      s.removeAllRanges(); s.addRange(nr);
      const off = offsetAt(loc.node, loc.off); lastSel = { start: off, end: off };
      return true;
    };
    const scheduleSync = () => { clearTimeout(syncT); syncT = setTimeout(() => { if (composing) return; const v = getText(), r = renumberLists(v); if (r !== v) { const c = readSel() || lastSel; render(r); setSel(c.start, c.end); pushHist(); return; } if (!rehighlightLine()) rehighlight(); pushHist(); }, 140); };   // on idle: if an ordered list fell out of sequence (item deleted/moved) renumber it once; else the normal light rehighlight
    ed.addEventListener('compositionstart', () => { composing = true; });
    ed.addEventListener('compositionend', () => { composing = false; scheduleSync(); });
    ed.addEventListener('input', () => { if (!composing) scheduleSync(); });

    render(orig); pushHist();
    const scrollCaretIntoView = () => { let el = locate(sel().start).node; if (el.nodeType === 3) el = el.parentElement; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); };
    // Programmatic edit (toolbar / find-replace): replace whole text, set caret, snapshot for undo
    const applyEdit = (newText, s, e) => { if (ed.getAttribute('contenteditable') === 'false') return; render(newText); setSel(s, (e === undefined ? s : e)); ed.focus(); pushHist(); };   // read-only guard: blocks toolbar + find/replace edits when the host locks the editor (B2)

    // Adapter exposing the slice of the <textarea> API the rest of the modal (and attachDatePicker) relies on
    const ta = {
      get value() { return getText(); },
      set value(v) { render(v); },
      get selectionStart() { return sel().start; },
      get selectionEnd() { return sel().end; },
      setSelectionRange(s, e) { setSel(s, e); },
      focus() { ed.focus(); },
      get scrollTop() { return scroll.scrollTop; }, set scrollTop(y) { scroll.scrollTop = y; },
      get clientHeight() { return scroll.clientHeight; },
      getBoundingClientRect() { return ed.getBoundingClientRect(); },
      addEventListener(...a) { ed.addEventListener(...a); },
      setAttribute() {},
    };

    // ---- Find / replace (toggled by the 🔍 toolbar button) ----
    const findbar = contentEl.createDiv({ cls: 'tugtile-ed-find' });
    contentEl.insertBefore(findbar, scroll);   // Between the toolbar and the editor body
    findbar.style.display = 'none';
    // Two groups, not one flat row. ▲▼ step through FIND matches, so they belong beside the find field;
    // flat, they landed on the far side of the replace box, with the whole replace field wedged between a
    // search term and the arrows that move through it. Grouping also gives the row somewhere sane to wrap.
    const findGrp = findbar.createSpan({ cls: 'tugtile-ed-find-grp' });
    const replGrp = findbar.createSpan({ cls: 'tugtile-ed-find-grp' });
    const findInp = findGrp.createEl('input', { cls: 'tugtile-ed-find-i', type: 'text', attr: { placeholder: t('findPlaceholder') } });
    const findN = findGrp.createSpan({ cls: 'tugtile-ed-find-n' });
    const replInp = replGrp.createEl('input', { cls: 'tugtile-ed-find-i', type: 'text', attr: { placeholder: t('replacePlaceholder') } });
    const lc = (s) => (s || '').toLowerCase();
    const updateN = () => { const term = findInp.value; findN.textContent = term ? String(lc(ta.value).split(lc(term)).length - 1) : ''; };
    const findNext = (back) => {
      const term = findInp.value; if (!term) return;
      const hay = lc(ta.value), needle = lc(term);
      let idx;
      if (back) { idx = hay.lastIndexOf(needle, Math.max(0, ta.selectionStart - 1)); if (idx < 0) idx = hay.lastIndexOf(needle); }
      else { idx = hay.indexOf(needle, ta.selectionEnd); if (idx < 0) idx = hay.indexOf(needle); }   // wrap around
      if (idx < 0) return;
      ed.focus(); setSel(idx, idx + term.length); scrollCaretIntoView();
    };
    const doReplace = () => {
      const term = findInp.value; if (!term) return;
      const v = getText(), s = sel().start, e = sel().end;
      if (lc(v.slice(s, e)) === lc(term)) applyEdit(v.slice(0, s) + replInp.value + v.slice(e), s + replInp.value.length);
      findNext(false); updateN();
    };
    const doReplaceAll = () => {
      const term = findInp.value; if (!term) return;
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      applyEdit(getText().replace(re, replInp.value), sel().start); updateN();
    };
    const toggleFind = (show) => {
      const on = (show === undefined) ? (findbar.style.display === 'none') : show;
      findbar.style.display = on ? '' : 'none';
      if (on) { updateN(); setTimeout(() => findInp.focus(), 0); } else { ta.focus(); }
    };
    const mkFb = (icon, aria, fn, target) => { const b = (target || findbar).createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-find-b' }); setIcon(b.createSpan(), icon); b.setAttribute('aria-label', aria); b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', fn); b.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false }); };
    mkFb('chevron-up', t('findPrev'), () => findNext(true), findGrp);
    mkFb('chevron-down', t('findNext'), () => findNext(false), findGrp);
    mkFb('replace', t('replaceOne'), doReplace, replGrp);
    mkFb('replace-all', t('replaceAll'), doReplaceAll, replGrp);
    mkFb('x', t('cancel'), () => toggleFind(false));   // stays a direct child — CSS pushes it to the far edge
    findInp.addEventListener('input', updateN);
    findInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(!!e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); toggleFind(false); } });

    // Editor shortcuts: edit the text model directly, then applyEdit re-highlights + snapshots undo; mousedown preventDefault retains the caret
    const wrap = (pre, post) => { const v = getText(), s = sel().start, e = sel().end; applyEdit(v.slice(0, s) + pre + v.slice(s, e) + post + v.slice(e), s + pre.length, e + pre.length); };
    const lineStartOf = (v, pos) => v.lastIndexOf('\n', pos - 1) + 1;
    // Line-prefix tools (bullet / number / check / quote). With a SELECTION it applies to EVERY line the selection
    // touches; with just a caret it toggles that one line (caret kept). ordered=true → numbers: any "N. " counts as
    // the prefix (so toggling off works on existing numbers), and adding renumbers the block 1..N. Blank lines are
    // left alone. Toggles OFF only when every non-blank line already has it.
    const togglePre = (pre, ordered) => {
      const v = getText(), s = sel().start, e = sel().end;
      const re = ordered ? /^\d+\.\s/ : null;
      const has = (ln) => (re ? re.test(ln) : ln.startsWith(pre));
      const strip = (ln) => (re ? ln.replace(re, '') : ln.slice(pre.length));
      if (s === e) {   // no selection → just the caret's line, caret preserved (original behaviour)
        const ls = lineStartOf(v, s), ln = v.slice(ls), h = has(ln);
        const cut = h ? (ln.length - strip(ln).length) : 0;
        const nv = h ? v.slice(0, ls) + strip(ln) + v.slice(ls + ln.length) : v.slice(0, ls) + (ordered ? '1. ' : pre) + v.slice(ls);
        applyEdit(nv, Math.max(ls, s + (h ? -cut : (ordered ? 3 : pre.length))));
        return;
      }
      const firstLs = lineStartOf(v, s), lastLs = lineStartOf(v, e - 1);
      const nlAfter = v.indexOf('\n', lastLs), blockEnd = nlAfter === -1 ? v.length : nlAfter;
      const lines = v.slice(firstLs, blockEnd).split('\n');
      const nonBlank = lines.filter((ln) => ln.trim() !== '');
      const allHave = nonBlank.length > 0 && nonBlank.every(has);
      let n = 0;
      const out = lines.map((ln) => {
        if (ln.trim() === '') return ln;                                   // leave blank lines alone
        if (allHave) return strip(ln);                                     // every non-blank has it → remove
        if (ordered) { n++; return n + '. ' + (re.test(ln) ? ln.replace(re, '') : ln); }   // renumber the block 1..N
        return has(ln) ? ln : pre + ln;                                    // bullet/check/quote → add where missing
      }).join('\n');
      applyEdit(v.slice(0, firstLs) + out + v.slice(blockEnd), firstLs, firstLs + out.length);   // keep the block selected
    };
    const setHeading = (hashes) => { const v = getText(), s = sel().start, ls = lineStartOf(v, s); const rest = v.slice(ls); const m = /^#{1,6}\s/.exec(rest); const cur = m ? m[0].length : 0; const repl = (m && m[0] === hashes) ? '' : hashes; const nv = v.slice(0, ls) + repl + rest.slice(cur); const np = Math.max(ls, s + (repl.length - cur)); applyEdit(nv, np); };
    // Bind a toolbar button so a TAP fires the action (keeping editor focus) but a SWIPE scrolls the row instead.
    // The old approach fired on touchstart+preventDefault, which was hair-trigger and blocked horizontal scrolling.
    const bindTap = (b, run) => {
      let tx = 0, ty = 0, moved = false;
      b.addEventListener('mousedown', (e) => e.preventDefault());   // Mouse: prevents focus loss in the editor
      b.addEventListener('click', run);                             // Mouse click path (suppressed on touch by the touchend below)
      b.addEventListener('touchstart', (e) => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; moved = false; }, { passive: true });
      b.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - tx) > 10 || Math.abs(t.clientY - ty) > 10) moved = true; }, { passive: true });
      b.addEventListener('touchend', (e) => { if (!moved) { e.preventDefault(); run(); } }, { passive: false });   // Fire only on a tap, not a scroll; preventDefault retains focus + blocks the synthetic click
    };
    const tbtn = (label, fn, icon, target, tip) => {
      const b = (target || tools).createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-tool' });
      if (tip) b.setAttribute('aria-label', t(tip));   // hover tooltip + accessible name (every tool button — was missing)
      if (icon) setIcon(b.createSpan(), icon); else b.textContent = label;   // setIcon into a child <span>, NOT the <button> directly — iPad WebKit won't render an inline svg that's a direct button child
      bindTap(b, () => { fn(); ed.focus(); });   // fn (applyEdit / undo / redo) already re-renders and refocuses
    };
    const insertTok = (tok) => { const v = getText(), s = sel().start; applyEdit(v.slice(0, s) + tok + v.slice(s), s + tok.length); };
    // image/video toolbar buttons: the host's pick hook (opts.pickImage/pickVideo) returns a markdown token (the
    // markup is uniform across surfaces; only WHERE the bytes live differs per platform). The picker is async and
    // blurs the editor (file dialog / prompt) → capture the caret BEFORE, re-insert at that offset when it resolves.
    const insertViaPick = (pick) => {
      if (typeof pick !== 'function' || ed.getAttribute('contenteditable') === 'false') return;
      const at = sel().start;
      Promise.resolve(pick()).then((tok) => {
        if (!tok || ed.getAttribute('contenteditable') === 'false') return;
        const v = getText(); applyEdit(v.slice(0, at) + tok + v.slice(at), at + tok.length);
      }).catch(() => {});
    };
    const runs = {
      undo: () => { if (hi > 0) { hi--; restore(hist[hi]); } }, redo: () => { if (hi < hist.length - 1) { hi++; restore(hist[hi]); } },
      h1: () => setHeading('# '), h2: () => setHeading('## '), h3: () => setHeading('### '),
      bold: () => wrap('**', '**'), italic: () => wrap('*', '*'), strike: () => wrap('~~', '~~'),
      bullet: () => togglePre('- '), number: () => togglePre('1. ', true), check: () => togglePre('- [ ] '), quote: () => togglePre('> '),
      table: () => { const v = getText(), s = sel().start, ls = lineStartOf(v, s); const pre = (ls > 0 && v[ls - 1] !== '\n') ? '\n' : ''; const tbl = pre + '|  |  |\n| --- | --- |\n|  |  |\n'; applyEdit(v.slice(0, ls) + tbl + v.slice(ls), ls + pre.length + 2); },   // insert a starter 2×2 table; decorateTables grids it for in-place editing
      code: () => wrap('`', '`'), link: () => wrap('[[', ']]'),
      image: () => insertViaPick(opts.pickImage), video: () => insertViaPick(opts.pickVideo),
      date: () => insertTok(host.dateTrigger || '@'), time: () => insertTok(host.timeTrigger || '@@'),
    };
    // Build the toolbar from EDITOR_TOOLS, honoring the per-button on/off settings; separators only appear between non-empty groups
    const en = host.plugin.settings.editorTools || {};
    // Phone rows: TOP = the bar's `tools` (search·undo·redo, the essentials); BOTTOM = tools2 (ALL format/insert
    // tools in one horizontally-scrollable row). 'rowbreak' is now a plain separator (phone seps are hidden anyway).
    let pendingSep = false;
    EDITOR_TOOLS.forEach((tk) => {
      if (tk === 'sep' || tk === 'rowbreak') { pendingSep = true; return; }
      if (en[tk.key] === false) return;   // honor per-button settings for ALL tools incl. search/undo/redo (so marktile can disable them); tugtile never sets these false → they stay on
      if (tk.needs && typeof opts[tk.needs] !== 'function') return;   // capability-gated tool (image/video): hide the button when the host didn't wire its hook → button exists IFF it works (no phantom)
      const target = tk.fixed ? tools : (twoRow ? tools2 : tools);   // fixed → bar; others → the second row on phone (the bar on desktop)
      if (pendingSep && target.childElementCount > 0) target.createDiv({ cls: 'tugtile-ed-sep' });   // separators (hidden in the compact phone rows) only between non-empty groups
      pendingSep = false;
      if (tk.key === 'search') {   // Special: toggles the find/replace bar (don't focus back to the textarea)
        const b = target.createEl('button', { cls: 'tugtile-iconbtn tugtile-ed-tool' });
        b.setAttribute('aria-label', t(tk.tip));   // "Find / replace"
        setIcon(b.createSpan(), 'search');   // span child, not the button (iPad svg-in-button fix)
        bindTap(b, () => toggleFind());
      } else {
        tbtn(tk.g, runs[tk.key], tk.icon, target, tk.tip);
      }
    });
    // A wrapped toolbar puts its dividers wherever the text would break: a `|` can end up first on a row,
    // separating the edge of the row from nothing, which is the small ugliness that makes a wrapped bar read
    // as debris rather than as a toolbar. CSS has no way to ask "is this element first on its line", so it is
    // measured. Rows are found by vertical CENTRE, not offsetTop — a 20px divider and a 40px button on the
    // same row have different tops by design. Hidden with `visibility`, never `display`, so the element keeps
    // its width and the fix cannot change the layout it just measured (and oscillate).
    const seps = () => [...(tools ? tools.children : [])].filter((e) => e.classList.contains('tugtile-ed-sep'));
    const tidySeps = () => {
      const kids = [...(tools ? tools.children : [])];
      const mid = (e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
      kids.forEach((el, i) => {
        if (!el.classList.contains('tugtile-ed-sep')) return;
        const prev = kids[i - 1], next = kids[i + 1];
        const alone = !prev || !next || mid(el) !== mid(prev) || mid(el) !== mid(next);
        el.style.visibility = alone ? 'hidden' : '';
      });
    };
    let sepRO = null;
    if (tools && seps().length && typeof ResizeObserver === 'function') {
      sepRO = new ResizeObserver(() => tidySeps());
      sepRO.observe(tools);
      tidySeps();
    }

    // Pure-source mode: if every tool is disabled and there's no ✕/✓ (marktile), drop the whole toolbar.
    if (!opts.onCancel && !opts.onSave && !tools.childElementCount && (!tools2 || !tools2.childElementCount)) { bar.remove(); if (tools2) tools2.remove(); }

    // Smart Enter: continue a list on newline (- / * / 1. / - [ ]); a second Enter on an empty item exits the
    // list. Runs through the proven applyEdit text-model (never touches the native Enter path), and only when
    // the caret line is actually a list item — otherwise it returns false and the native newline happens.
    const tryListContinue = () => {
      const r = readSel(); if (!r || r.start !== r.end) return false;   // collapsed caret only
      const res = listContinuation(getText(), r.start);
      if (!res) return false;
      applyEdit(res.text, res.caret);
      return true;
    };

    host.attachDatePicker(ta);
    ta.addEventListener('keydown', (e) => {
      if (host.isSubmitKey(e)) { e.preventDefault(); if (opts.onSubmit) opts.onSubmit(); return; }
      // Undo/redo via OUR snapshot stack (same as the toolbar buttons). The editor rebuilds innerHTML on every
      // re-highlight, which wipes the contenteditable's native undo — so Cmd+Z must NOT rely on the browser's
      // native undo (that's why it silently stopped working). preventDefault blocks native; stopPropagation keeps
      // the board's document-level ⌘Z handler out; the read-only guard mirrors the toolbar (locked = no edits).
      if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 'z') {
        e.preventDefault(); e.stopPropagation();
        if (ed.getAttribute('contenteditable') !== 'false') { if (e.shiftKey) runs.redo(); else runs.undo(); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 'y') {   // ⌘/Ctrl+Y = redo (Windows convention)
        e.preventDefault(); e.stopPropagation();
        if (ed.getAttribute('contenteditable') !== 'false') runs.redo();
        return;
      }
      if (e.key === 'Escape' && opts.onEscape) { e.preventDefault(); opts.onEscape(); return; }   // hosts without a cancel action (marktile) let Escape fall through naturally
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && tryListContinue()) e.preventDefault();   // newline-producing Enter (submit already handled above) → continue the list if on one
      if (e.key === 'Tab' && !e.isComposing) {   // insert/remove a literal tab (contenteditable's default Tab just moves focus)
        e.preventDefault();
        const r = readSel(); if (!r) return;
        const res = tabEdit(getText(), r.start, r.end, e.shiftKey);
        if (res) applyEdit(res.text, res.caret);
      }
    });
    // Only auto-focus a fresh (empty) card — then the keyboard is ready to type. For existing content, DON'T focus: leave it to the user's tap, so the caret lands where they tap instead of jumping to the end.
    if (!orig) setTimeout(() => ta.focus(), 0);

    // iOS virtual keyboard handling. Two defenses, because visualViewport doesn't reliably shrink in Obsidian's
    // webview: (1) if it DOES, cap the sizing container to the visible height so the scroll region ends above the
    // keyboard; (2) regardless, keep the caret line within the top ~45% of the scroll viewport — which is above
    // where the keyboard sits even when the scroll area itself extends under it. The editor content carries a
    // tall bottom padding (CSS) so there's always room to scroll the last real line up.
    const vv = window.visualViewport;
    const sizer = contentEl.closest('.tugtile-edit-modal-full');   // ONLY the full-screen card modal; null in marktile's pane (don't clamp a leaf to vv.height — that mis-sizes desktop split panes) (L4)
    const keepCaretVisible = () => {
      const n = locate(sel().start).node;
      const lineEl = (n && n.nodeType === 3) ? n.parentElement : n;
      if (!lineEl || !lineEl.getBoundingClientRect) return;
      const lr = lineEl.getBoundingClientRect(), sr = scroll.getBoundingClientRect();
      const upper = sr.top + sr.height * 0.45;
      if (lr.bottom > upper) scroll.scrollTop += (lr.bottom - upper);
    };
    const applyVV = () => { if (vv && sizer) { sizer.style.height = vv.height + 'px'; sizer.style.maxHeight = vv.height + 'px'; } setTimeout(keepCaretVisible, 0); };
    if (vv) { vv.addEventListener('resize', applyVV); vv.addEventListener('scroll', applyVV); applyVV(); }
    ed.addEventListener('input', () => setTimeout(keepCaretVisible, 0));   // keep the caret above the keyboard as you type

  return {
    getValue: () => getText().replace(/\s+$/, ''),
    rawValue: () => getText(),
    setText: (text) => { if (ed.getAttribute('contenteditable') === 'false') return; render(text); pushHist(); },   // programmatic whole-document replace (TOC drag-reorder); pushHist → undoable + fires onChange (autosave). read-only guard like applyEdit.
    isDirty: () => getText().replace(/\s+$/, '') !== orig.replace(/\s+$/, ''),
    insertText: (text) => insertTok(text),   // insert at the caret (used by image paste/drop); applyEdit's read-only guard applies
    // Every toolbar button, by key, for hosts that have a SECOND door to the same capability — a macOS menu
    // bar and its ⌘-equivalents. It is deliberately the same `runs` map the buttons are bound to: a menu that
    // reimplemented "bold" would be a second definition of what bold means, and the two would drift on the
    // first change. Returns false for an unknown key so a host can't silently ship a dead menu item.
    runTool: (key) => { const fn = runs[key]; if (!fn) return false; fn(); ed.focus(); return true; },
    toggleFind: (show) => toggleFind(show),   // ⌘F — the same bar the magnifier opens
    focus: () => ta.focus(),
    destroy: () => { clearTimeout(syncT); if (sepRO) { sepRO.disconnect(); sepRO = null; } if (vv) { vv.removeEventListener('resize', applyVV); vv.removeEventListener('scroll', applyVV); } if (sizer) { sizer.style.height = ''; sizer.style.maxHeight = ''; } },
  };
}

// Full-screen, keyboard-safe source editor. Callback-driven (opts.text / opts.onSave / opts.onDiscard) so board cards, table rows, and the whole markdown file all reuse it.
// Host interface the editor needs from whatever embeds it — the board view, or a minimal marktile file host.
// This is the seam that lets the SAME editor open a kanban card OR a standalone .md file. A host duck-types
// this surface (BoardView already does; a marktile host no-ops the board-only parts):
//   _editModalOpen (writable flag), freezeBoard(), unfreezeBoard(), closePopup(), consumePendingReload(),
//   attachDatePicker(taAdapter), isSubmitKey(e)->bool, dateTrigger, timeTrigger, plugin.settings.editorTools
class TileEditModal extends Modal {
  constructor(app, view, opts) { super(app); this.view = view; this.host = (opts && opts.host) || view; this._opts = opts || {}; }
  onOpen() {
    this.host._editModalOpen = true;
    this.host.freezeBoard();
    this.modalEl.addClass('tugtile-edit-modal-full');
    // Tag the modal CONTAINER so the backdrop/alignment rules can target it directly instead of via
    // .modal-container:has(.tugtile-edit-modal-full) — same timing as the modalEl class above, but no :has()
    // selector invalidation. Guarded: the web host's shim Modal may not expose containerEl.
    if (this.containerEl) this.containerEl.addClass('tugtile-edit-host');
    // Obsidian vault hooks (source path = the board file): image save/resolution. Computed up here so mountEditor's
    // toolbar image/video buttons and equipEditor's paste handler share the same seam.
    const app = this.app, srcPath = (this.view && this.view.file) ? this.view.file.path : '';
    this._ctrl = mountEditor(this.contentEl, {
      text: this._opts.text || '',
      onSubmit: () => this._doClose('save'), onEscape: () => this._requestClose(),   // keyboard: Enter saves, Escape cancels (the ✕/✓ buttons live in the control strip below)
      onToc: () => { if (this._rig && this._rig.toc) this._rig.toc.toggle(); },
      pickImage: () => pickVaultImage(app, srcPath), pickVideo: () => promptVideoEmbed(),   // toolbar 🖼/🎞 → vault save / URL embed
    }, this.host);
    // Equip the same rig marktile uses → tugtile's big editor is literally marktile + the ✕/✓ buttons. Host hooks:
    // Obsidian vault image resolution (source path = the board file) and the TOC's Sortable + mobile/anchor tuning.
    this._rig = equipEditor({
      mount: this.contentEl, ctrl: this._ctrl,
      enabledModes: (this.host.plugin && this.host.plugin.settings && this.host.plugin.settings.modes) || {},
      seasonedColor: !!(this.host.plugin && this.host.plugin.settings && this.host.plugin.settings.seasonedColor),
      saveImage: (blob) => saveVaultImage(app, srcPath, blob),   // paste/drop an image → vault attachment + ![[…]]
      resolveSrc: (raw) => {
        raw = String(raw).split('|')[0].trim();
        if (/^(https?:|data:|app:)/i.test(raw)) return raw;
        if (!/\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(raw.split('#')[0])) return null;
        try { const f = app.metadataCache.getFirstLinkpathDest(raw, srcPath); return f ? app.vault.getResourcePath(f) : null; } catch (e) { return null; }
      },
      toc: {
        Sortable: (typeof Sortable !== 'undefined' ? Sortable : (typeof window !== 'undefined' ? window.Sortable : null)),
        labels: { title: t('mtToc'), empty: t('mtTocEmpty') },
        onReorder: () => {}, anchorScroll: '.tugtile-ed-scroll',
        sortableOptions: { delay: 180, delayOnTouchOnly: true, touchStartThreshold: 8, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, dragClass: 'marktile-toc-item--drag' },
      },
    });
    // Control strip in marktile's exact markup, prepended above the toolbar: [✕] · viewcycle · lock · [✓]. So the
    // big editor reads as marktile + the modal's cancel/save. (marktile builds the same-looking strip in its header.)
    const strip = createDiv({ cls: 'tugtile__ctlbar' });
    this._ctl = buildEditorCtl(strip, {
      cycleMode: () => { if (this._rig) this._rig.cycleMode(); },
      currentMode: () => (this._rig ? this._rig.currentMode() : EDITOR_MODES[0]),
      toggleLock: () => this._toggleLock(),
      isLocked: () => !!this._locked,
      brand: t('mtBrand'), brandLocked: t('mtBrandLocked'),
      modeLabel: t('mtModeToggle'), lockLabel: t('mtLockToggle'),
      onCancel: () => this._requestClose(), cancelLabel: t('cancel'),
      onSave: () => this._doClose('save'), saveLabel: t('save'),
    });
    this.contentEl.prepend(strip);
  }
  _toggleLock() { this._locked = !this._locked; this._applyLock(); }
  _applyLock() { const ed = this.contentEl.querySelector('.tugtile-ed-rich'); if (ed) ed.setAttribute('contenteditable', String(!this._locked)); this.contentEl.toggleClass('tugtile--locked', !!this._locked); }
  _dirty() { return !!this._ctrl && this._ctrl.isDirty(); }
  close() {
    if (this._forceClose) { this._animateClose(); return; }
    // Implicit closing (backdrop click or iOS virtual keyboard collapse) → ignored to prevent accidental close or save. Dismissed only via Save/Cancel/Escape.
  }
  _requestClose() {   // Explicit cancel (Cancel button or Escape key)
    if (!this._dirty()) { this._doClose('discard'); return; }
    if (typeof window.confirm === 'function') { if (window.confirm(t('discardConfirm'))) this._doClose('discard'); /* otherwise do nothing */ }
    else this._doClose('save');   // Mobile devices without confirm dialog → save changes to prevent data loss
  }
  _animateClose() {
    if (this._closing) { return; } this._closing = true;
    // Reverse exit animation: appends class to trigger pop-out animation, then closes. Saving has already finished in _doClose → _save; the animation is purely visual and does not delay saving.
    this.modalEl.addClass('tugtile-ed-closing');
    setTimeout(() => super.close(), 300);   // Align with pop-out animation duration (0.32s)
  }
  _doClose(mode) {
    this._forceClose = true;
    if (mode === 'save') this._save();
    else if (this._opts.onDiscard) this._opts.onDiscard();   // e.g. board discards a newly inserted empty card
    this.close();
  }
  onClose() {
    if (this._rig) { this._rig.destroy(); this._rig = null; }
    if (this._ctrl) this._ctrl.destroy();
    this.host._editModalOpen = false;
    this.host.unfreezeBoard();
    this.host.closePopup();
    this.contentEl.empty();
    this.host.consumePendingReload();   // Process external modifications deferred during modal editing
  }
  _save() {
    if (this._done) return; this._done = true;
    const v = this._ctrl ? this._ctrl.getValue() : '';
    if (this._opts.onSave) this._opts.onSave(v);
  }
}


// ───────────────────────────────────────────────────────────────────────────
// TABLE GRID (the "locked markers" in-grid markdown-table editor). Single source
// for tugtile/marktile (inlined) AND the web host (tile-core emit). decorateTables(root,
// ctrl, gateClass) restyles contiguous |table| line-divs into an aligned grid and
// makes them editable in place; gateClass selects the host's "grid on" class —
// both marktile and the web host use 'marktile-grid' (set in Seasoned + Rendered, dropped
// in Plain). The .tugtile-preview overlay then hides the pipes in Rendered, in CSS
// only. (gateClass defaults to 'tugtile-preview' for older callers.) textContent stays
// byte-identical → round-trip exact, no other core change.
// ───────────────────────────────────────────────────────────────────────────

// table-align — cheap markdown-table prettifier: pad cells with spaces so the pipes line up in a monospace
// editor. Stays single-layer (output is still valid markdown, edits in place, round-trips) — no CSS table, no
// widget. The one catch is CJK: 中文/日文/全形 are DOUBLE-width, so we measure DISPLAY width (east-asian-width),
// NOT code-point length, or the pipes drift. Pure string → runs in node + browser. See [[web-known-pitfalls]].

// East Asian Width: 2 for wide/fullwidth code points, else 1. Practical subset for zh/ja (not the full UAX#11
// table, but covers CJK ideographs, kana, hangul, and fullwidth forms/punctuation — what real content uses).
const WIDE = [
  [0x1100, 0x115F],   // Hangul Jamo
  [0x2E80, 0x303E],   // CJK radicals · Kangxi · CJK symbols & punctuation （、。「」…）
  [0x3041, 0x33FF],   // Hiragana · Katakana · enclosed CJK
  [0x3400, 0x4DBF],   // CJK Ext A
  [0x4E00, 0x9FFF],   // CJK Unified Ideographs
  [0xA000, 0xA4CF],   // Yi
  [0xAC00, 0xD7A3],   // Hangul syllables
  [0xF900, 0xFAFF],   // CJK compatibility ideographs
  [0xFE30, 0xFE4F],   // CJK compatibility forms
  [0xFF00, 0xFF60],   // Fullwidth forms （！？（）　…）
  [0xFFE0, 0xFFE6],   // Fullwidth signs
  [0x20000, 0x3FFFD], // CJK Ext B+ (supplementary planes)
];
function charWidth(cp) { for (const [a, b] of WIDE) if (cp >= a && cp <= b) return 2; return 1; }
function dispWidth(s) { let w = 0; for (const ch of String(s)) w += charWidth(ch.codePointAt(0)); return w; }

const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSepRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));

// Parse a contiguous block of table source lines into { header, align, body, ncol } for rendering a real
// <table>. Returns null if it isn't a valid table (2nd line must be the |---| separator). Used by the 編輯-mode
// table widget (table-view.js) — the browser then measures real glyph widths, so CJK columns align regardless
// of font (the fill-to-fit escape from the space-quantum problem).
function parseTable(lines) {
  const rows = lines.map(splitRow);
  if (rows.length < 2 || !isSepRow(rows[1])) return null;
  const ncol = Math.max(...rows.map((r) => r.length));
  const align = [];
  for (let i = 0; i < ncol; i++) { const t = (rows[1][i] || '').trim(); const l = t.startsWith(':'), r = t.endsWith(':'); align[i] = (l && r) ? 'center' : r ? 'right' : 'left'; }
  return { header: rows[0], align, body: rows.slice(2), ncol };
}

// Format ONE contiguous table block (source lines) → aligned lines; null if it isn't a real table.
function formatBlock(lines) {
  if (lines.length < 2) return null;
  const rows = lines.map(splitRow);
  if (!isSepRow(rows[1])) return null;                       // 2nd line MUST be the |---| separator
  const ncol = Math.max(...rows.map((r) => r.length));
  const align = [];
  for (let i = 0; i < ncol; i++) { const t = (rows[1][i] || '').trim(); const l = t.startsWith(':'), r = t.endsWith(':'); align[i] = (l && r) ? 'c' : r ? 'r' : 'l'; }
  const w = [];
  for (let i = 0; i < ncol; i++) { let mx = 3; rows.forEach((r, ri) => { if (ri !== 1) mx = Math.max(mx, dispWidth(r[i] || '')); }); w[i] = mx; }
  const pad = (text, width, a) => {
    const gap = width - dispWidth(text); if (gap <= 0) return text;
    if (a === 'r') return ' '.repeat(gap) + text;
    if (a === 'c') { const left = gap >> 1; return ' '.repeat(left) + text + ' '.repeat(gap - left); }
    return text + ' '.repeat(gap);
  };
  return rows.map((r, ri) => {
    if (ri === 1) return '| ' + w.map((width, i) => { const d = '-'.repeat(width); return align[i] === 'c' ? ':' + d.slice(2) + ':' : align[i] === 'r' ? d.slice(1) + ':' : d; }).join(' | ') + ' |';
    return '| ' + w.map((width, i) => pad(r[i] || '', width, align[i])).join(' | ') + ' |';
  });
}

// Re-align every contiguous markdown table block; non-table text is untouched. Idempotent.
function formatTables(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (isTableLine(lines[i])) {
      let j = i; const block = [];
      while (j < lines.length && isTableLine(lines[j])) block.push(lines[j++]);
      const fixed = formatBlock(block);
      if (fixed) { out.push(...fixed); i = j - 1; continue; }
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

// table-view — in 編輯 mode, restyle a contiguous markdown table block so it LOOKS like a real grid with
// aligned columns — CJK included — and lets you EDIT INSIDE the grid safely, without touching marktile core.
//
// Why restyle the line <div>s IN PLACE (not insert a <table> widget): marktile's text model assumes the editor
// root's children ARE the lines (getText joins child textContent; caret math + lineCount walk the same children).
// So we keep the SAME line divs and only regroup each line's inner nodes (cells/pipes into spans) + CSS. Every
// line's textContent stays byte-identical → round-trip exact, no core change.
//
// In-grid editing rests on three legs (the "locked markers" design):
//   1. LOCKED MARKERS — every hidden pipe span is contenteditable=false (only in 編輯 mode), so the caret can't
//      enter the syntax and a stray Backspace can't eat a pipe: the table structure is physically indestructible.
//      A beforeinput guard additionally blocks deletions whose target range would cross a pipe / cell / row
//      boundary. Typed characters flow into the cell's text node → the markdown is naturally correct.
//   2. SYNC RE-WRAP — marktile rebuilds a line's innerHTML after edits (wiping our spans). MutationObserver
//      callbacks are microtasks that run BEFORE paint, so re-wrapping synchronously in the callback (with caret
//      capture/restore around the surgery) is flicker-free by construction. No debounce.
//   3. TABLE KEYS, two dialects:
//      · markdown 魂 — typing '|' in a cell SPLITS THE COLUMN there (the syntax IS the command; the split is
//        propagated to every row so the table stays rectangular).
//      · Word 遺毒 — Tab hops cells and GROWS A ROW from the last cell; Enter inserts a row below; right-click
//        opens insert/delete column/row — the habits real (non-technical) operators arrive with.
// 調味/原味 show raw source: pipes visible and fully editable there (locks are preview-mode-only).

// Undo our wrapping: restore marktile's inline nodes + literal | text and drop our classes (idempotent base).
function unwrapLine(line) {
  if (!line.querySelector('.ej-cell, .ej-pipe')) { line.classList.remove('ej-trow', 'ej-thead', 'ej-tsep'); return; }
  line.querySelectorAll('.ej-pipe').forEach((p) => p.replaceWith(document.createTextNode('|')));
  line.querySelectorAll('.ej-cell').forEach((c) => { while (c.firstChild) c.parentNode.insertBefore(c.firstChild, c); c.remove(); });
  line.normalize();
  line.classList.remove('ej-trow', 'ej-thead', 'ej-tsep');
}

// Group ONE highlighted line into cell/pipe spans, PRESERVING marktile's inline nodes (tg-b / tg-mk / tg-link)
// inside each cell — bold/italic render and their markers hide like everywhere else in 編輯 mode, textContent
// byte-identical. Splits at top-level '|' text only; tags each cell with its column alignment.
function wrapLine(line, aligns) {
  unwrapLine(line);
  const cells = []; let cur = [];
  for (const node of [...line.childNodes]) {
    if (node.nodeType === 3 && node.nodeValue.indexOf('|') >= 0) {
      const segs = node.nodeValue.split('|');
      for (let i = 0; i < segs.length; i++) { if (i > 0) { cells.push(cur); cur = []; } if (segs[i] !== '') cur.push(document.createTextNode(segs[i])); }
    } else { cur.push(node); }
  }
  cells.push(cur);
  const frag = document.createDocumentFragment();
  cells.forEach((nodes, ci) => {
    if (ci > 0) { const p = document.createElement('span'); p.className = 'ej-pipe'; p.textContent = '|'; frag.appendChild(p); }
    if (ci === 0 || ci === cells.length - 1) { nodes.forEach((n) => frag.appendChild(n)); return; }   // outer | … | border, no cell
    const c = document.createElement('span'); c.className = 'ej-cell';
    const a = aligns && aligns[ci - 1]; if (a && a !== 'left') c.dataset.a = a;
    nodes.forEach((n) => c.appendChild(n)); frag.appendChild(c);
  });
  line.textContent = '';   // drop the leftover original text nodes (the '|'-bearing ones were copied, not moved)
  line.appendChild(frag);
}

// caret char-offset within a line (textContent positions) — captured/restored around our DOM surgery
function caretOffset(line) {
  const s = getSelection(); if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0); if (!line.contains(r.startContainer)) return null;
  const pre = document.createRange(); pre.selectNodeContents(line); pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
function setCaret(line, off) {
  let rem = off; const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    const len = n.nodeValue.length;
    const inPipe = n.parentElement && n.parentElement.closest('.ej-pipe');   // locked+hidden — the caret can't live there;
    if (rem <= len && !inPipe) { const r = document.createRange(); r.setStart(n, rem); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; }
    if (rem <= len && inPipe) { rem = 0; continue; }                          // boundary inside a pipe → start of the NEXT visible node
    rem -= len;
  }
}

const nthPipe = (t, n) => { let c = -1; for (let k = 0; k < t.length; k++) { if (t[k] === '|') c++; if (c === n) return k; } return -1; };

function decorateTables(root, ctrl, gateClass) {
  const inPreview = () => root.classList.contains(gateClass || 'tugtile-preview');
  const lineOf = (node) => { if (!node || !root.contains(node)) return null; const el = node.nodeType === 3 ? node.parentElement : node; return el && el.closest ? el.closest('.tg-line') : null; };
  const caretLineEl = () => { const s = getSelection(); return s && s.rangeCount ? lineOf(s.anchorNode) : null; };
  const T = (k, fb) => { try { const s = (typeof t === 'function') ? t(k) : null; return (s != null && s !== k) ? s : fb; } catch (e) { return fb; } };

  const setLocks = (line, on) => line.querySelectorAll('.ej-pipe').forEach((p) => { if (on) p.setAttribute('contenteditable', 'false'); else p.removeAttribute('contenteditable'); });

  const blockRows = (line) => { let r = line; while (r.previousElementSibling && r.previousElementSibling.classList.contains('ej-trow')) r = r.previousElementSibling;
    const rows = []; for (; r && r.classList.contains('ej-trow'); r = r.nextElementSibling) rows.push(r); return rows; };
  const cellsOf = (rows) => rows.filter((x) => !x.classList.contains('ej-tsep')).flatMap((x) => [...x.querySelectorAll('.ej-cell')]);

  // WebKit doesn't propagate a row's content-width change to the SIBLING rows of the anonymous table box (the
  // header column stays stuck until you type in it). Cure: kick every row of the edited block out of table
  // context and back (style-only, no DOM mutation → selection survives), forcing the anonymous table to be
  // rebuilt with fresh column widths. Runs inside the MO microtask = before paint → invisible.
  const relayout = (block) => {
    block.forEach((l) => { l.style.display = 'block'; });
    void block[0].offsetWidth;   // flush layout while the rows are out of the table
    block.forEach((l) => { l.style.display = ''; });
  };

  const scan = () => {
    obs.disconnect();
    try {
      const cl = caretLineEl(); const clOff = cl ? caretOffset(cl) : null; let touchedCaret = false;
      const lock = inPreview();
      const lines = [...root.querySelectorAll('.tg-line')];
      let i = 0;
      while (i < lines.length) {
        if (isTableLine(lines[i].textContent)) {
          let j = i; const block = [];
          while (j < lines.length && isTableLine(lines[j].textContent)) block.push(lines[j++]);
          const parsed = parseTable(block.map((l) => l.textContent));
          if (parsed) {
            block.forEach((l, k) => {
              if (!l.classList.contains('ej-trow')) { wrapLine(l, parsed.align); l.classList.add('ej-trow'); if (k === 0) l.classList.add('ej-thead'); if (k === 1) l.classList.add('ej-tsep'); if (l === cl) touchedCaret = true; }
              setLocks(l, lock);
            });
            if (lock && block.indexOf(cl) >= 0) relayout(block);   // typing in this block → resync sibling-row column widths
          }
          i = j; continue;
        }
        if (lines[i].classList.contains('ej-trow')) { if (lines[i] === cl) touchedCaret = true; unwrapLine(lines[i]); }   // edited out of a table → restore
        i++;
      }
      if (touchedCaret && cl && clOff != null) setCaret(cl, clOff);   // our surgery moved the caret's nodes — put it back
    } finally { obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] }); }
  };

  // ---- whole-document table transforms (one ctrl.setText each = one undo step; caret restored after) ----
  const docEdit = (mutate) => {
    const all = [...root.querySelectorAll('.tg-line')];
    const doc = ctrl.rawValue().split('\n');
    const caret = mutate(all, doc) || {};   // mutate doc in place; returns {caretLine, caretOff}
    ctrl.setText(doc.join('\n'));
    if (caret.caretLine != null) { const fresh = root.querySelectorAll('.tg-line')[caret.caretLine]; if (fresh) setCaret(fresh, caret.caretOff || 0); }
  };

  // cell index of a char offset in a row's text (0-based; -1 = before the leading border pipe)
  const cellIndexAt = (t, off) => { let ci = -1; for (let k = 0; k < off; k++) if (t[k] === '|') ci++; return ci; };

  // insert an empty column so the NEW cell sits at index `at` in every row of `line`'s block
  const insertColumn = (line, at, caretRow) => docEdit((all, doc) => {
    const rows = blockRows(line); let out = null;
    for (const r of rows) {
      const ix = all.indexOf(r); const t = doc[ix];
      const cell = r.classList.contains('ej-tsep') ? ' --- |' : '  |';
      const open = nthPipe(t, at);                                  // pipe that OPENS index `at`
      const pos = open < 0 ? t.length : open + 1;
      doc[ix] = t.slice(0, pos) + cell + t.slice(pos);
      if (r === (caretRow || line)) out = { caretLine: ix, caretOff: pos + 1 };
    }
    return out;
  });

  const deleteColumn = (line, ci) => docEdit((all, doc) => {
    const rows = blockRows(line); let out = null;
    for (const r of rows) {
      const ix = all.indexOf(r); const t = doc[ix];
      const open = nthPipe(t, ci), close = nthPipe(t, ci + 1);
      if (open < 0) continue;
      doc[ix] = close < 0 ? t.slice(0, open + 1) : t.slice(0, open) + t.slice(close);
      if (r === line) out = { caretLine: ix, caretOff: Math.max(1, open) };
    }
    return out;
  });

  const insertRow = (line, below) => docEdit((all, doc) => {
    const rows = blockRows(line);
    const parsed = parseTable(rows.map((l) => l.textContent)); if (!parsed) return null;
    // from the header, "below" means below the |---| separator; "above" the header is not a table place
    let anchor = line;
    if (line.classList.contains('ej-thead')) anchor = below ? rows[1] : rows[0];
    const ix = all.indexOf(anchor) + (below ? 1 : 0);
    doc.splice(ix, 0, '|' + '  |'.repeat(parsed.ncol));
    return { caretLine: ix, caretOff: 2 };
  });

  const deleteRow = (line) => docEdit((all, doc) => {
    const ix = all.indexOf(line);
    doc.splice(ix, 1);
    return { caretLine: Math.max(0, ix - 1), caretOff: 2 };
  });

  // ---- Word-habit context menu: right-click a cell → insert/delete column/row ----
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  document.addEventListener('click', closeMenu, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
  root.addEventListener('contextmenu', (e) => {
    if (!inPreview() || !ctrl) return;
    const cellEl = e.target && e.target.closest ? e.target.closest('.ej-cell') : null; if (!cellEl) return;
    const line = cellEl.closest('.tg-line'); if (!line || !line.classList.contains('ej-trow')) return;
    e.preventDefault(); closeMenu();
    const ci = [...line.querySelectorAll('.ej-cell')].indexOf(cellEl);
    const rows = blockRows(line);
    const ncol = (parseTable(rows.map((l) => l.textContent)) || { ncol: 1 }).ncol;
    const isHead = line.classList.contains('ej-thead');
    menu = document.createElement('div'); menu.className = 'ej-tblmenu';
    const item = (label, fn, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (disabled) b.disabled = true;
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = (ev) => { ev.stopPropagation(); closeMenu(); fn(); }; menu.appendChild(b); return b; };
    item(T('TBL_INS_COL_L', '在左方插入欄'), () => insertColumn(line, ci, line));
    item(T('TBL_INS_COL_R', '在右方插入欄'), () => insertColumn(line, ci + 1, line));
    menu.appendChild(document.createElement('hr'));
    item(T('TBL_INS_ROW_A', '在上方插入列'), () => insertRow(line, false), isHead);
    item(T('TBL_INS_ROW_B', '在下方插入列'), () => insertRow(line, true));
    menu.appendChild(document.createElement('hr'));
    item(T('TBL_DEL_COL', '刪除欄'), () => deleteColumn(line, ci), ncol <= 1);
    item(T('TBL_DEL_ROW', '刪除列'), () => deleteRow(line), isHead);
    menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();   // keep on screen
    if (r.right > innerWidth) menu.style.left = (innerWidth - r.width - 8) + 'px';
    if (r.bottom > innerHeight) menu.style.top = (e.clientY - r.height) + 'px';
  });

  // ---- table keys (capture phase: marktile's Tab/Enter handlers must not see these) ----
  root.addEventListener('keydown', (e) => {
    if (!inPreview()) return;
    const line = caretLineEl(); if (!line || !line.classList.contains('ej-trow')) return;
    if (e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      const rows = blockRows(line);
      const cells = cellsOf(rows);
      const s = getSelection(); const cur = s.rangeCount ? (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode).closest('.ej-cell') : null;
      const ix = cells.indexOf(cur);
      if (!e.shiftKey && ix === cells.length - 1) { insertRow(rows[rows.length - 1], true); return; }   // Word habit: Tab past the end grows a row
      const next = cells[(ix < 0 ? 0 : ix + (e.shiftKey ? -1 : 1) + cells.length) % cells.length];
      if (next) { const rg = document.createRange(); rg.selectNodeContents(next); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); }
      return;
    }
    if (e.key === 'Enter') {   // Enter in a cell = NEW ROW below (a raw newline would split the row)
      e.preventDefault(); e.stopPropagation();
      if (ctrl) insertRow(line, true);
      return;
    }
  }, true);

  // ---- typing '|' in a cell = SPLIT THE COLUMN here (the syntax IS the command) ----
  // In plain markdown a pipe splits that one row; in the grid we propagate the split to EVERY row of the
  // block (empty cell after the same column; the |---| row gets a matching ---), keeping the table rectangular.
  root.addEventListener('beforeinput', (e) => {
    if (!inPreview() || !ctrl || e.inputType !== 'insertText' || e.data !== '|') return;
    const line = caretLineEl(); if (!line || !line.classList.contains('ej-trow')) return;
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return;
    const anchorEl = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
    if (!anchorEl.closest('.ej-cell')) return;   // only inside a cell (not the outer | borders)
    e.preventDefault(); e.stopPropagation();
    const off = caretOffset(line); if (off == null) return;
    const ci = cellIndexAt(line.textContent, off);
    docEdit((all, doc) => {
      const rows = blockRows(line); let out = null;
      for (const r of rows) {
        const ix = all.indexOf(r); const t = doc[ix];
        if (r === line) { doc[ix] = t.slice(0, off) + '|' + t.slice(off); out = { caretLine: ix, caretOff: off + 1 }; continue; }
        const close = nthPipe(t, ci + 1);                                               // closing pipe of cell ci
        const cell = r.classList.contains('ej-tsep') ? ' --- |' : '  |';
        doc[ix] = close < 0 ? t + cell : t.slice(0, close + 1) + cell + t.slice(close + 1);
      }
      return out;
    });
  }, true);

  // ---- deletion guard: block any delete whose target range would cross a pipe / cell / row boundary ----
  root.addEventListener('beforeinput', (e) => {
    if (!inPreview() || !e.inputType || !e.inputType.startsWith('delete')) return;
    const line = caretLineEl(); const inTable = line && line.classList.contains('ej-trow');
    const ranges = e.getTargetRanges ? e.getTargetRanges() : [];
    if (!ranges.length) { return; }
    for (const r of ranges) {
      const sl = lineOf(r.startContainer), el = lineOf(r.endContainer);
      if (!(sl && sl.classList.contains('ej-trow')) && !(el && el.classList.contains('ej-trow')) && !inTable) continue;
      if (sl !== el) { e.preventDefault(); return; }                                        // crossing a row boundary dissolves the table
      const sC = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
      const eC = (r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer);
      if (sC.closest('.ej-pipe') || eC.closest('.ej-pipe')) { e.preventDefault(); return; }  // touching a locked marker
      const c1 = sC.closest('.ej-cell'), c2 = eC.closest('.ej-cell');
      if (c1 !== c2) { e.preventDefault(); return; }                                         // crossing a cell boundary
    }
  }, true);

  const obs = new MutationObserver(scan);   // microtask → re-wrap runs BEFORE paint → flicker-free by construction
  scan();
  return obs;
}

// Inline image thumbnails — show the picture beside its still-editable source line. The source text stays in the
// line (textContent untouched → round-trip exact, the markdown model is unaffected); a contenteditable=false <img>
// is appended as a sibling. resolveSrc(raw) maps the matched path/url to a real displayable src, or null to skip —
// the web host passes web URLs through, marktile resolves vault paths (and returns null for non-images). marktile
// rebuilds the line divs on every keystroke, so a debounced MutationObserver re-applies. Shared by both hosts;
// this is the first step of Rendered "growing" — the same widget pattern later carries math / callouts.
function decorateImages(root, resolveSrc) {
  const resolve = resolveSrc || ((u) => u);
  const scan = () => {
    root.querySelectorAll('.tg-line').forEach((line) => {
      const txt = line.textContent || '';
      const m = txt.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/) || txt.match(/!\[[^\]]*\]\(([^)]+)\)/) || txt.match(/<img[^>]+src=["']([^"']+)["']/);
      const url = m ? resolve(m[1]) : null;
      const cur = line.querySelector(':scope > img.ej-inlimg');
      if (url) {
        if (!cur || cur.dataset.u !== url) {
          if (cur) cur.remove();
          const im = document.createElement('img');
          im.className = 'ej-inlimg'; im.contentEditable = 'false'; im.draggable = false; im.dataset.u = url; im.src = url;
          line.appendChild(im); line.classList.add('ej-hasimg');
        }
      } else if (cur) { cur.remove(); line.classList.remove('ej-hasimg'); }
    });
  };
  let t; const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 80); });
  obs.observe(root, { childList: true, subtree: true, characterData: true });
  scan();
  return obs;
}

// Table of contents — the ONE shared TOC for marktile (Obsidian) and the web host. Lists H1–H3 (tocHeadings),
// click to jump, drag to reorder whole sections (moveSection via Sortable). One visual (.marktile-toc* classes in
// the shared sheet). Hosts pass: mount (container), ctrl (editor controller), labels {title, empty} (each host
// resolves its own i18n), and optional Sortable (defaults to window.Sortable), onReorder (after a drag),
// onNavigate (after a click — e.g. marktile closes on phone), anchorScroll (selector whose offsetTop the panel
// pins below, for Obsidian's in-flow toolbar; the web host anchors via CSS), sortableOptions (extra Sortable opts, e.g.
// marktile's mobile touch tuning). Returns { toggle, refresh, destroy }.
function wireToc(opts) {
  const { mount, ctrl, labels, onReorder, onNavigate, anchorScroll, sortableOptions } = opts;
  const Sortable = opts.Sortable || (typeof window !== 'undefined' ? window.Sortable : null);
  let open = false, panel = null, debT = null, sortable = null;
  const lab = labels || {};
  const ensure = () => { if (panel && panel.isConnected) return; panel = document.createElement('div'); panel.className = 'marktile-toc'; mount.appendChild(panel); };
  const killSortable = () => { if (sortable) { try { sortable.destroy(); } catch (e) {} sortable = null; } };
  function build() {
    const ed = mount.querySelector('.tugtile-ed-rich'); if (!ed || !panel) return;
    if (anchorScroll) { const s = mount.querySelector(anchorScroll); if (s) panel.style.top = s.offsetTop + 'px'; }   // pin below the in-flow toolbar (Obsidian)
    killSortable();
    panel.innerHTML = '';
    const ti = document.createElement('div'); ti.className = 'marktile-toc-title'; ti.textContent = lab.title || ''; panel.appendChild(ti);
    const list = document.createElement('div'); list.className = 'marktile-toc-list'; panel.appendChild(list);
    const lineEls = ed.querySelectorAll('.tg-line'); const heads = tocHeadings(ctrl ? ctrl.rawValue() : '');
    if (!heads.length) { const e = document.createElement('div'); e.className = 'marktile-toc-empty'; e.textContent = lab.empty || ''; list.appendChild(e); return; }
    heads.forEach((h) => {
      const it = document.createElement('div'); it.className = 'marktile-toc-item marktile-toc-l' + h.level; it.textContent = h.text || '—';
      it.onclick = () => { const el = lineEls[h.line]; if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); if (onNavigate) onNavigate(); };
      list.appendChild(it);
    });
    if (Sortable) try {
      sortable = new Sortable(list, Object.assign({
        draggable: '.marktile-toc-item', animation: 150,
        ghostClass: 'marktile-toc-item--ghost', chosenClass: 'marktile-toc-item--chosen',
        onEnd: (ev) => {
          const cur = ctrl.rawValue(); const next = moveSection(cur, ev.oldIndex, ev.newIndex);
          if (next !== cur && ctrl.setText) { ctrl.setText(next); if (onReorder) onReorder(); }
          setTimeout(() => { if (open) build(); }, 0);   // deferred: don't destroy the active Sortable from inside its own onEnd
        },
      }, sortableOptions || {}));
    } catch (e) {}
  }
  return {
    toggle(force) { open = (force === undefined) ? !open : !!force; if (open) { ensure(); build(); } mount.classList.toggle('marktile-toc-open', open); },
    refresh() { if (!open) return; clearTimeout(debT); debT = setTimeout(() => { if (open) build(); }, 250); },
    isOpen() { return open; },
    destroy() { killSortable(); panel = null; open = false; },
  };
}

// The editor "rig" — the full marktile experience any host equips on a mounted editor: the Seasoned/Rendered/Plain
// mode cycle (the class on `mount`), in-grid tables, inline images, and the TOC, all wired once. Hosts pass the
// mount + controller + their host-specific hooks (resolveSrc image resolver, toc options, which modes are enabled,
// an initialMode to restore across a rebuild) and render their OWN viewcycle button by calling cycleMode()/
// currentMode(). One rig — equipped by MarktileView, TileEditModal and the web editor alike — so "the editor" is
// literally one thing everywhere it appears.
const EDITOR_MODES = [
  { key: 'seasoned', cls: '', icon: 'square-m', name: 'mtModeSeasoned' },
  { key: 'rendered', cls: 'tugtile-preview', icon: 'square-pen', name: 'mtModeRendered' },
  { key: 'plain', cls: 'tugtile-plain', icon: 'square-code', name: 'mtModePlain' },
];
// Rendered mode hides the literal `[ ]` / `[x]` and puts a box glyph in its place (styles.css,
// .tg-check::before). A box you can see but can't press is a half-finished affordance — so this wires
// the gesture everyone will try. Click the box, the SOURCE toggles; the glyph follows because it was
// only ever a view of the text.
// This lives in the core, not in a host: it is a capability, and the toolbar/behaviour surface is the
// core's single source. Every surface that renders the box gets the same click, and none of them grow
// their own version of it.
// Only active where the box is a glyph. In Seasoned/Plain the `[x]` is literal text the person edits
// directly, and stealing that click would fight normal caret placement.
function wireTaskToggle(mount, ctrl) {
  const onClick = (e) => {
    if (!mount.classList.contains('tugtile-preview')) return;
    const el = (e.target && e.target.nodeType === 1) ? e.target : (e.target && e.target.parentElement);
    const box = (el && el.closest) ? el.closest('.tg-check') : null;
    if (!box) return;
    const lineEl = box.closest('.tg-line');
    if (!lineEl) return;
    // .tg-line divs map 1:1 onto source lines, in order — the same mapping wireToc/moveSection rely on.
    const lines = Array.prototype.slice.call(mount.querySelectorAll('.tg-line'));
    const ix = lines.indexOf(lineEl);
    const src = ctrl.rawValue().split('\n');
    if (ix < 0 || ix >= src.length) return;
    const next = src[ix].replace(/^(\s*[-*]\s)\[([ xX])\]/, (m, pre, mark) => pre + (mark === ' ' ? '[x]' : '[ ]'));
    if (next === src[ix]) return;   // not a task line after all — let the click through untouched
    e.preventDefault();
    e.stopPropagation();
    src[ix] = next;
    ctrl.setText(src.join('\n'));   // whole-document replace: undoable + fires onChange, the same path TOC reorder uses
  };
  mount.addEventListener('click', onClick, true);
  return { destroy() { try { mount.removeEventListener('click', onClick, true); } catch (e) {} } };
}

function equipEditor(opts) {
  const { mount, ctrl, enabledModes, resolveSrc, toc, saveImage } = opts;
  const onModes = () => { const md = enabledModes || {}; const on = EDITOR_MODES.filter((m) => md[m.key] !== false); return on.length ? on : EDITOR_MODES; };
  let ix = 0;
  if (opts.initialMode) { const i = onModes().findIndex((m) => m.key === opts.initialMode); if (i >= 0) ix = i; }
  const current = () => { const e = onModes(); return e[ix % e.length]; };
  const applyMode = () => {
    const m = current();
    mount.classList.toggle('marktile-grid', m.key !== 'plain');   // tables become a locked grid in Seasoned & Rendered
    mount.classList.toggle('tugtile-preview', m.cls === 'tugtile-preview');   // Rendered hides the markers
    mount.classList.toggle('tugtile-plain', m.cls === 'tugtile-plain');       // Plain = raw source
  };
  const tableObs = decorateTables(mount, ctrl, 'marktile-grid');
  const imgObs = resolveSrc ? decorateImages(mount, resolveSrc) : null;
  const tocCtl = toc ? wireToc(Object.assign({ mount, ctrl }, toc)) : null;
  const paste = saveImage ? wireImagePaste(mount, ctrl, saveImage) : null;
  const taskCtl = wireTaskToggle(mount, ctrl);   // Rendered-mode checkbox click → source toggle
  mount.classList.toggle('marktile-palette-color', !!opts.seasonedColor);   // Seasoned palette: accent (default) vs per-token colour; host passes the setting
  applyMode();
  return {
    currentMode: current,
    applyMode,
    cycleMode() { ix = (ix + 1) % onModes().length; applyMode(); },
    toc: tocCtl,
    destroy() { try { tableObs.disconnect(); } catch (e) {} if (imgObs) { try { imgObs.disconnect(); } catch (e) {} } if (tocCtl) tocCtl.destroy(); if (paste) paste.destroy(); if (taskCtl) taskCtl.destroy(); },
  };
}

// The editor control strip — viewcycle + lock in marktile's exact markup (.tugtile-headerctl), with OPTIONAL
// cancel/save buttons on the ends. marktile builds its own strip inside the hijacked Obsidian header; TileEditModal
// builds THIS one at the top of the modal, so tugtile's big editor reads as "marktile + ✕/✓" — one look, two
// placements. ctl: { cycleMode, currentMode, toggleLock, isLocked, brand, brandLocked, modeLabel, lockLabel,
// onCancel, cancelLabel, onSave, saveLabel }. Returns { el, refresh }.
function buildEditorCtl(parent, ctl) {
  const wrap = parent.createSpan({ cls: 'tugtile-headerctl' });
  const iconBtn = (icon, label, fn) => { const b = wrap.createEl('button', { cls: 'tugtile-iconbtn' }); setIcon(b.createSpan(), icon); b.setAttribute('aria-label', label || ''); b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); }; return b; };
  if (ctl.onCancel) iconBtn('x', ctl.cancelLabel, ctl.onCancel);   // ✕ on the left (modal only)
  const vc = wrap.createSpan({ cls: 'tugtile-viewcycle' });
  vc.setAttribute('role', 'button'); vc.setAttribute('aria-label', ctl.modeLabel || '');
  vc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); ctl.cycleMode(); refresh(); };
  wrap.createSpan({ cls: 'tugtile-sep', text: '·' });
  const lk = wrap.createSpan({ cls: 'tugtile-brand' });
  lk.setAttribute('role', 'button'); lk.setAttribute('aria-label', ctl.lockLabel || '');
  lk.onclick = (e) => { e.preventDefault(); e.stopPropagation(); ctl.toggleLock(); refresh(); };
  if (ctl.onSave) iconBtn('check', ctl.saveLabel, ctl.onSave);   // ✓ on the right (modal only)
  // ctl.stableWidth — opt-in, because whether this matters is a question about PLACEMENT, and placement
  // belongs to the surface. Both labels change width in use (the mode name cycles, the brand swaps to its
  // locked form), which only hurts where the strip shares a flex row with something centred: the macOS
  // host, where every mode switch nudged the whole toolbar. In Obsidian's header it costs nothing, so it
  // is not imposed there.
  //
  // The reservation goes on the WRAPPER — which has no background — with the contents pinned right. Put
  // it on the label instead and the mode pill itself stretches, leaving the text marooned in a wide box.
  // This way the pill hugs its word, the separator/brand/lock never move, and only the pill's left edge
  // travels through empty space.
  //
  // Measured, never hard-coded: 'Seasoned', 'アジツケ' and '調味' are three different widths, and a px that
  // fits one clips or pads the others.
  let reserved = false;
  function reserveWidth(nameEl, brandEl) {
    if (reserved || !ctl.stableWidth || !wrap.isConnected) return;   // detached at build time → the first connected refresh sizes it
    const name0 = nameEl.textContent, brand0 = brandEl.textContent;
    let max = 0;
    EDITOR_MODES.forEach((m) => {          // every name × both brand forms: the widest COMBINATION, not the
      nameEl.textContent = t(m.name);      // widest of each measured apart
      [ctl.brand || '', ctl.brandLocked || ''].forEach((bd) => {
        brandEl.textContent = bd;
        max = Math.max(max, wrap.offsetWidth);
      });
    });
    nameEl.textContent = name0; brandEl.textContent = brand0;
    if (max > 0) { wrap.style.minWidth = max + 'px'; wrap.style.justifyContent = 'flex-end'; reserved = true; }
  }

  function refresh() {   // populate unconditionally — the strip is built detached (before prepend), so an isConnected gate would skip the first paint
    vc.empty(); const m = ctl.currentMode(); setIcon(vc.createSpan({ cls: 'tugtile-viewcycle-icon' }), m.icon);
    const nameEl = vc.createSpan({ cls: 'tugtile-viewcycle-name', text: t(m.name) });
    lk.empty(); const locked = ctl.isLocked && ctl.isLocked();
    const brandEl = lk.createSpan({ cls: 'tugtile-brand-text', text: locked ? (ctl.brandLocked || '') : (ctl.brand || '') });
    setIcon(lk.createSpan({ cls: 'tugtile-lock-icon' }), locked ? 'lock' : 'lock-open');
    reserveWidth(nameEl, brandEl);
  }
  refresh();
  return { el: wrap, refresh };
}

// Image paste/drop — without this, the browser shoves a base64 <img> into the contenteditable that getText() can't
// see, so a pasted picture silently vanishes on the next render. Here we intercept image paste/drop, hand the blob
// to the host's saveImage(blob) → markdown link (Obsidian: save to the vault attachment folder; web host: upload),
// and insert that link at the caret — then decorateImages shows the thumbnail. Returns { destroy }.
function wireImagePaste(root, ctrl, saveImage) {
  const handle = async (files) => {
    for (const f of files) {
      if (!f || !f.type || f.type.indexOf('image/') !== 0) continue;
      try { const link = await saveImage(f); if (link) ctrl.insertText(link); } catch (e) {}
    }
  };
  const onPaste = (e) => {
    const items = e.clipboardData && e.clipboardData.items; const files = [];
    if (items) for (const it of items) { if (it.kind === 'file') { const f = it.getAsFile(); if (f && f.type && f.type.indexOf('image/') === 0) files.push(f); } }
    if (files.length) { e.preventDefault(); e.stopPropagation(); handle(files); }
  };
  const onDrop = (e) => {
    const fl = e.dataTransfer && e.dataTransfer.files; const imgs = fl ? [...fl].filter((f) => f.type && f.type.indexOf('image/') === 0) : [];
    if (imgs.length) { e.preventDefault(); e.stopPropagation(); handle(imgs); }
  };
  root.addEventListener('paste', onPaste, true);
  root.addEventListener('drop', onDrop, true);
  return { destroy() { root.removeEventListener('paste', onPaste, true); root.removeEventListener('drop', onDrop, true); } };
}

// Obsidian saveImage hook — save a pasted/dropped blob into the vault's attachment folder and return an embed link.
// Used by both Obsidian hosts (marktile + tugtile's editor modal); the web host passes its own web-upload saveImage instead.
async function saveVaultImage(app, sourcePath, blob) {
  const ext = (blob.type && blob.type.split('/')[1]) || 'png';
  const stamp = (typeof Date !== 'undefined' && Date.now) ? Date.now() : Math.floor(performance.now());
  const path = await app.fileManager.getAvailablePathForAttachment('pasted-' + stamp + '.' + ext, sourcePath || '');
  const file = await app.vault.createBinary(path, await blob.arrayBuffer());
  return '![[' + file.name + ']]';
}

// Obsidian image-insert hook for the toolbar 🖼 button: pick a file → save to the vault → return the SAME canonical
// embed paste/drop produces (![[name]]), so the button and paste are byte-identical. Hosts pass this as opts.pickImage.
function pickVaultImage(app, sourcePath) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) return resolve(null);
      try { resolve(await saveVaultImage(app, sourcePath, f)); } catch (e) { resolve(null); }
    };
    inp.click();
  });
}
// Canonical video embed — ONE markup for every surface (Obsidian + web), so a post stays portable (publish from
// Obsidian → website renders the same). YouTube/Vimeo → responsive iframe; a direct file → <video>; else a plain link.
function videoEmbed(url) {
  let m;
  if ((m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/)))
    return '<figure class="ej-video"><iframe src="https://www.youtube.com/embed/' + m[1] + '" title="video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></figure>';
  if ((m = url.match(/vimeo\.com\/(\d+)/)))
    return '<figure class="ej-video"><iframe src="https://player.vimeo.com/video/' + m[1] + '" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></figure>';
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return '<figure class="ej-video"><video src="' + url + '" controls></video></figure>';
  return '<p><a href="' + url + '">' + url + '</a></p>';
}
// Prompt for a video URL → canonical embed (toolbar 🎞 button). Shared by every host as opts.pickVideo.
function promptVideoEmbed() {
  const url = (typeof prompt === 'function') ? prompt(t('edVideoPrompt')) : null;
  const u = url && url.trim();
  return u ? videoEmbed(u) : null;
}

const DEFAULT_SETTINGS = {
  laneWidth: 'medium',       // Lane width preset: 'narrow' | 'medium' | 'wide' (mapped to px by LANE_WIDTHS)
  tableDensity: 'medium',    // Table row spacing preset: 'narrow' | 'medium' | 'wide' (mapped to px by TABLE_PADS)
  showCheckboxes: false, hideCounts: false, showRelativeDate: true, dateDisplayFormat: 'YYYY-MM-DD',
  enterSubmits: true,        // Enter to submit (false = Enter to newline, Shift/Cmd+Enter to submit)
  prependNewCards: false,    // Add new cards to the bottom of the lane (true = add to the top)
  archiveWithDate: false,    // Append timestamp when archiving
  maxArchiveSize: -1,        // Cap on archived cards per board; oldest dropped beyond it (-1 / 0 = unlimited)
  backupRetention: 20,       // How many _tugtile-backups snapshots to keep per board (oldest pruned beyond this; -1 = keep all)
  archiveHeading: 'Archive', // Heading for newly created archive sections (uses localized strings in kanban to align when returning to kanban; can be customized to "Archive", etc.)
  responsiveBoard: false,    // When on, the board auto-reflows to a vertical stack on narrow panes
  editorTools: {},           // Per-button on/off for the editor toolbar (missing key = on); see EDITOR_TOOLS
  modes: {},                 // Per-mode on/off for the big editor's view cycle (missing key = on); see EDITOR_MODES
  seasonedColor: false,      // Seasoned highlight palette: false = single accent tint, true = per-token colours
};

const VIEW_TYPE = 'tugtile-board';

// A lightweight version of monkey-around: wraps a method and returns a restore function (verifies no other wrappers were added before restoring)
function aroundMethod(obj, method, factory) {
  const original = obj[method];
  const wrapped = factory(original);
  obj[method] = wrapped;
  return () => { if (obj[method] === wrapped) obj[method] = original; };
}

// Constants for progressive auto-scrolling (increase SCROLL_MAX for faster scrolling)
const SCROLL_EDGE = 70;   // Edge detection threshold (px): triggers scrolling when close to the boundary
const SCROLL_MAX = 22;    // Maximum scroll speed per frame (px) at the outermost edge

/* ===================== CORE: markdown board ↔ model (written from scratch, format compatible, unit testable in Node) =====================
   model = { pre, columns:[{ header, title, tiles:[{ raw, text }] }], post }
   - pre  = Original text before the first `## ` (e.g., frontmatter), preserved as-is.
   - post = Original text starting from `%% kanban:settings`, preserved as-is.
   - tile.raw = Exact markdown text of the card in the file (`- [ ]` line + tab-indented content, trailing blank lines trimmed) → used for writing back, content preserved verbatim.
   - tile.text = Card body markdown after removing `- [ ]` and one level of indentation → used for rendering. */
// Normalise a lane name into the archive home-key: strip the %% token delimiter, collapse any whitespace (incl.
// full-width 　 / NBSP, which \s matches) to a single space, trim. MUST be applied on BOTH sides (writing the token
// and matching on restore) or a full-width-space lane name won't match its own token. See archive-restore-e2e.test.
function homeKey(s) { return String(s || '').replace(/%%/g, '').replace(/\s+/g, ' ').trim(); }
function tileRenderText(tileLines) {
  const out = [];
  const m = tileLines[0].match(/^- \[.\] ?(.*)/);    // Do not use $ (remaining \r in CRLF causes (.*)$ to fail to match the end of line)
  out.push((m ? m[1] : tileLines[0]).replace(/\s*%%tg-home:.*?%%/, ''));   // hide the archive home-lane token (archived cards only; no-op on active cards)
  for (let i = 1; i < tileLines.length; i++) {
    out.push(tileLines[i].replace(/^(?:\t| {1,4})/, ''));   // Remove indentation for wrapped lines: one tab or 1-4 spaces
  }
  return out.join('\n');
}

// For table view: strip markdown formatting (headings, bold, italics, strikethrough, inline code, and links) to get plain text. Table styling is completely managed by us to ensure uniform font sizes.
function tilePlainText(s) {
  return String(s)
    .replace(/^#{1,6}\s+/, '')                                              // Heading hashes
    .replace(/(\*\*|__)(.+?)\1/g, '$2')                                     // Bold
    .replace(/(\*|_)(.+?)\1/g, '$2')                                        // Italic
    .replace(/~~(.+?)~~/g, '$1')                                            // Strikethrough
    .replace(/`([^`]+)`/g, '$1')                                            // Inline code
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a)    // wikilink / embeds
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')                              // Markdown links / images
    .trim();
}

// Visual (display) width of a string in monospace "columns", counting East-Asian wide / fullwidth
// characters as 2 and everything else as 1. WHY: JavaScript's String.length counts UTF-16 code units,
// so "理牌" (2 ideographs) reports length 2 even though it occupies ~4 latin-character widths on screen.
// The long-card collapse heuristic compares against a visual budget (60), so it must reason in display
// columns, not code units — otherwise a CJK card that is already visually longer than a 60-char latin
// card would stay expanded. Pure + Obsidian-free so it can be unit-tested in Node (lives in CORE).
// Iterates by Unicode code point (for..of / the string iterator yields whole code points, correctly
// pairing surrogate halves) so astral characters are measured once, not twice.
function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    // Ranges treated as width-2 (the practical CJK set tugtile cards use). Kept as explicit, commented
    // ranges rather than a regex so each block is auditable and easy to extend.
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||   // Hangul Jamo (leading consonants render full-width)
      (cp >= 0x2E80 && cp <= 0x303E) ||   // CJK Radicals, Kangxi Radicals, CJK Symbols & Punctuation (incl. U+3000 ideographic space)
      (cp >= 0x3041 && cp <= 0x33FF) ||   // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, CJK enclosures/compat
      (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
      (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified Ideographs (the main block)
      (cp >= 0xA000 && cp <= 0xA4CF) ||   // Yi Syllables / Yi Radicals
      (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
      (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
      (cp >= 0xFE30 && cp <= 0xFE4F) ||   // CJK Compatibility Forms (vertical/overline punctuation)
      (cp >= 0xFF00 && cp <= 0xFF60) ||   // Fullwidth Forms (fullwidth ASCII variants + fullwidth punctuation ：，！？)
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||   // Fullwidth currency / sign forms
      (cp >= 0x20000 && cp <= 0x3FFFD)    // CJK Unified Ideographs Extensions B–F (astral plane; reached via surrogate pairs)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function parseFile(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';   // Detect the line endings of the original file to restore during serialization (prevents mixed line endings / CRLF leftovers)
  const lines = text.split(/\r\n|\r|\n/);           // Normalize line endings internally to \n
  // settings/end must be calculated first. If firstCol is not found, fallback to laneEnd (instead of lines.length); otherwise, an empty board will swallow settings into pre and corrupt the file.
  const settingsIdx = lines.findIndex((l) => l.indexOf('%% kanban:settings') === 0 || l.indexOf('%% tugtile:settings') === 0);   // Dual-read: accept legacy kanban marker and the native tugtile marker
  const end = settingsIdx === -1 ? lines.length : settingsIdx;

  // End of frontmatter (prevents frontmatter --- delimiters from being misidentified as horizontal rules)
  let fmEnd = 0;
  if (lines[0] === '---') { const c = lines.indexOf('---', 1); if (c !== -1) fmEnd = c + 1; }

  const isFence = (l) => /^(```|~~~)/.test(l);                // Top-level code fence (indented card contents are not affected)
  const isHr = (l) => /^\*\*\*+\s*$/.test(l);                 // Archive separator: only matches *** (kanban's archiveString, to avoid misidentifying lead ---/___ horizontal lines as archive markers and swallowing lanes)
  const isHeading = (l) => l.indexOf('## ') === 0;

  // Archive section start: a horizontal rule within the board area, not inside a fence, and followed by a `## ` heading (after skipping blank lines) counts as the separator.
  // The "followed by heading" condition avoids false positives from isolated horizontal rules in the lead or card text, which would otherwise silently archive active cards.
  let archiveIdx = -1;
  { let fence = false;
    for (let i = fmEnd; i < end; i++) {
      if (isFence(lines[i])) { fence = !fence; continue; }
      if (fence) continue;
      if (isHr(lines[i])) {
        let j = i + 1;
        while (j < end && lines[j].trim() === '') j++;
        if (j < end && isHeading(lines[j])) { archiveIdx = i; break; }
      }
    }
  }
  const laneEnd = archiveIdx === -1 ? end : archiveIdx;
  const archive = archiveIdx === -1 ? '' : lines.slice(archiveIdx, end).join('\n').replace(/^\s+/, '').replace(/\s+$/, '');

  // The first valid lane (inside the lanes section, not within a fence), falls back to laneEnd if not found
  let firstCol = -1;
  { let fence = false;
    for (let i = fmEnd; i < laneEnd; i++) {
      if (isFence(lines[i])) { fence = !fence; continue; }
      if (!fence && isHeading(lines[i])) { firstCol = i; break; }
    }
  }
  if (firstCol === -1) firstCol = laneEnd;

  const pre = lines.slice(0, firstCol).join('\n');
  const post = settingsIdx === -1 ? '' : lines.slice(settingsIdx).join('\n');

  const columns = [];
  let col = null, tileLines = null, fence = false;
  const flush = () => {
    if (tileLines && col) {
      const cl = tileLines.slice();
      while (cl.length && cl[cl.length - 1].trim() === '') cl.pop();
      const cm = /^- \[(.)\]/.exec(cl[0]);
      const bm = /\s+\^([A-Za-z0-9-]+)$/.exec(cl[0]);   // blockId (hidden during display but preserved verbatim in raw to prevent breaking links like [[#^id]])
      const clForText = cl.slice();
      if (bm) clForText[0] = cl[0].slice(0, bm.index);
      col.tiles.push({ raw: cl.join('\n'), text: tileRenderText(clForText), check: cm ? cm[1] : ' ', block: bm ? bm[1] : null });
    }
    tileLines = null;
  };
  for (let i = firstCol; i < laneEnd; i++) {
    const ln = lines[i];
    if (isFence(ln)) { fence = !fence; if (tileLines) tileLines.push(ln); else if (col) col.lead.push(ln); continue; }
    if (!fence && isHeading(ln)) {
      flush();
      col = { header: ln, title: ln.slice(3).trim(), tiles: [], lead: [] };
      columns.push(col);
      continue;
    }
    if (!col) continue;
    if (!fence && /^- \[.\]/.test(ln)) { flush(); tileLines = [ln]; }
    else if (tileLines) tileLines.push(ln);
    else col.lead.push(ln);             // Non-card text before the first card at the top of the lane (preserved, not discarded)
  }
  flush();
  for (const c of columns) {            // Trim leading/trailing blank lines from lead text (preserving internal lines)
    while (c.lead.length && c.lead[0].trim() === '') c.lead.shift();
    while (c.lead.length && c.lead[c.lead.length - 1].trim() === '') c.lead.pop();
  }
  // Fault-tolerant parser for settings JSON (only used for reading flags like show-checkboxes; serialization still preserves the raw post as-is without rewriting)
  let settings = {};
  const sm = /```\s*\n([\s\S]*?)\n```/.exec(post);
  if (sm) { try { settings = JSON.parse(sm[1]); } catch (e) { settings = {}; } }

  return { pre, columns, archive, post, settings, eol };
}

function serializeFile(model) {
  const pre = (model.pre || '').replace(/\s+$/, '');
  const body = model.columns
    .map((c) => {
      const lead = (c.lead && c.lead.length) ? c.lead.join('\n') + '\n\n' : '';
      return c.header + '\n\n' + lead + c.tiles.map((cd) => cd.raw).join('\n');
    })
    .join('\n\n\n');
  const archive = (model.archive || '').replace(/^\s+/, '').replace(/\s+$/, '');  // Preserve the archive section as-is
  const post = (model.post || '').replace(/^\s+/, '').replace(/\s+$/, '');  // Trim leading/trailing spaces → idempotent (preventing file from bloating on multiple saves)
  let out = (pre ? pre + '\n\n' : '') + body;
  if (archive) out += '\n\n\n' + archive;
  if (post) out += '\n\n\n' + post;
  out += '\n';
  return model.eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out;   // Restore original line endings (to avoid mixing line ending styles)
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Formats date/time based on moment-style tokens (supports common tokens like YYYY/MM/DD/HH/mm/M/D to align with kanban's usage)
function formatDateTokens(p, fmt) {
  const pad = (n) => String(n).padStart(2, '0');
  return (fmt || 'YYYY-MM-DD')
    .replace(/YYYY/g, String(p.y)).replace(/MM/g, pad(p.mo)).replace(/DD/g, pad(p.d))
    .replace(/HH/g, pad(p.h || 0)).replace(/mm/g, pad(p.mi || 0))
    .replace(/\bM\b/g, String(p.mo)).replace(/\bD\b/g, String(p.d));
}
// Parses a date string based on date-format → returns {y,mo,d} or null (for invalid dates). Supports common tokens, treats others as literals.
function parseDateStr(str, fmt) {
  const toks = ['YYYY', 'MM', 'DD', 'HH', 'mm', 'M', 'D'];
  const order = []; let re = '', i = 0; fmt = fmt || 'YYYY-MM-DD';
  while (i < fmt.length) {
    const t = toks.find((tk) => fmt.startsWith(tk, i));
    if (t) { order.push(t); re += t === 'YYYY' ? '(\\d{4})' : (t.length === 2 ? '(\\d{1,2})' : '(\\d{1,2})'); i += t.length; }
    else { re += escapeRe(fmt[i]); i++; }
  }
  const m = new RegExp('^' + re).exec(str || '');
  if (!m) return null;
  const o = {}; order.forEach((t, idx) => { o[t] = parseInt(m[idx + 1], 10); });
  const y = o.YYYY, mo = o.MM || o.M, d = o.DD || o.D;
  if (!y || !mo || !d) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;   // Handle invalid dates like Month 13 or Day 45
  return { y, mo, d };
}

// Extracts kanban-formatted date `@{YYYY-MM-DD}` and time `@@{HH:mm}` from card text (trigger character is configurable).
// Match time first, then date (to prevent `@{` from matching the trailing part of `@@{`, complying with kanban's overlapping prefix rule). Returns { clean, date, time }.
function extractMeta(text, dateTrig, timeTrig) {
  dateTrig = dateTrig || '@'; timeTrig = timeTrig || '@@';
  let date = null, time = null, clean = text || '';
  const tFirst = new RegExp(escapeRe(timeTrig) + '\\{([^}]*)\\}');
  const dFirst = new RegExp(escapeRe(dateTrig) + '\\{([^}]*)\\}');
  const mt = tFirst.exec(clean); if (mt) time = mt[1];
  clean = clean.replace(new RegExp(escapeRe(timeTrig) + '\\{[^}]*\\}', 'g'), '');   // Clear all time tokens first (preventing @{ from matching the end of @@{)
  const md = dFirst.exec(clean); if (md) date = md[1];
  clean = clean.replace(new RegExp(escapeRe(dateTrig) + '\\{[^}]*\\}', 'g'), '');    // Clear all date tokens (only uses the first match, removes duplicates/residuals)
  // Recognizes daily note format like @[[YYYY-MM-DD]] (kanban link-date-to-daily-note) as a date
  if (date == null) { const dl = new RegExp(escapeRe(dateTrig) + '\\[\\[([^\\]]*)\\]\\]').exec(clean); if (dl) date = dl[1]; }
  clean = clean.replace(new RegExp(escapeRe(dateTrig) + '\\[\\[[^\\]]*\\]\\]', 'g'), '');
  clean = clean.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  return { clean, date, time };
}

// Extracts #tags from the card (supports CJK; stops at spaces or common punctuation). Returns an array of tag strings including the # prefix.
const TAG_RE = /#[^\s#,.;:!?，。、；：！？（）()\[\]{}"'\\]+/gu;
function extractTags(text) {
  const out = []; let m; const re = new RegExp(TAG_RE.source, 'gu');
  while ((m = re.exec(text || '')) !== null) out.push(m[0]);
  return out;
}

// Parses the WIP limit `(N)` at the end of the lane heading: returns { title: title without (N), max: number|null }.
function parseWip(title) {
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(title || '');
  return m ? { title: m[1], max: parseInt(m[2], 10) } : { title: title || '', max: null };
}

// Rewrites a specific key in the settings JSON block (preserving all other settings verbatim) or inserts it if missing. The value is JSON serialized.
function setSetting(post, key, value) {
  const kq = JSON.stringify(key);
  const kv = kq + ':' + JSON.stringify(value);
  // Create settings block if missing (otherwise view/collapse preferences cannot be saved)
  if (!post || (post.indexOf('kanban:settings') === -1 && post.indexOf('tugtile:settings') === -1)) return '%% tugtile:settings\n```\n{' + kv + '}\n```\n%%';   // No block yet → create a native tugtile one; existing kanban/tugtile blocks are edited in place (marker preserved until the user upgrades)
  const re = new RegExp(escapeRe(kq) + '\\s*:\\s*(?:"(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\]|\\{[^}]*\\}|true|false|null|-?\\d+(?:\\.\\d+)?)');
  if (re.test(post)) return post.replace(re, () => kv);               // Use a function replacer to prevent interpreting $ as special regex characters
  if (/\{\s*\}/.test(post)) return post.replace(/\{\s*\}/, () => '{' + kv + '}');
  return post.replace(/\{/, () => '{' + kv + ',');
}
// Writes back list-collapse (an array of booleans indicating collapse states, matching lane order) using setSetting
function setListCollapse(post, arr) { return setSetting(post, 'list-collapse', arr); }

// --- Fold-all cycle (PURE, platform-free) — the 3-state decision logic, shared by the Obsidian board (BoardView
// reads the live DOM then calls these) and the web surface (board-core.js). The DOM/animation APPLY stays per-host;
// only the "which state, what it means, what icon" decisions live here. Invariant: lanes collapsed ⇒ everything shut.
const FOLD_ICONS = ['maximize-2', 'expand', 'shrink'];   // index by NEXT state — the icon hints the action the next click does
const FOLD_TARGETS = [                                    // what each state means for lanes/cards
  { lanesCollapsed: false, cardsExpanded: false },        // 0: lanes open, cards folded
  { lanesCollapsed: false, cardsExpanded: true },         // 1: all open
  { lanesCollapsed: true, cardsExpanded: false },         // 2: all collapsed
];
function foldStateFrom(allLanesCollapsed, allLongTilesOpen) { return allLanesCollapsed ? 2 : (allLongTilesOpen ? 1 : 0); }
function nextFold(state) { return (state + 1) % 3; }
function foldTargets(state) { return FOLD_TARGETS[state] || FOLD_TARGETS[0]; }
function foldIcon(state) { return FOLD_ICONS[nextFold(state)]; }   // the button shows the NEXT action

// Settings keys tugtile understands; "upgrade to tugtile format" keeps only these and drops kanban-only keys for a clean file.
const TUGTILE_SETTING_KEYS = ['show-checkboxes', 'hide-card-count', 'date-trigger', 'time-trigger', 'date-format', 'date-display-format', 'time-format', 'link-date-to-daily-note', 'show-relative-date', 'tag-colors', 'move-tags', 'tag-action', 'archive-date-format', 'archive-date-separator', 'append-archive-date', 'new-line-trigger', 'new-card-insertion-method', 'archive-with-date', 'max-archive-size', 'list-collapse', 'tugtile-view', 'tugtile-locked'];
// True if the file still carries obsidian-kanban markers (frontmatter key or settings marker).
function hasKanbanFormat(text) { return /^---[\s\S]*?\bkanban-plugin\b/.test(text || '') || (text || '').indexOf('%% kanban:settings') !== -1; }
// One-way upgrade: rename the markers to tugtile's and rebuild the settings block keeping ONLY known keys (clean). Structure (- [ ] / ## lanes / blockIds / *** / archive) is untouched. Idempotent.
function migrateToTugtile(text) {
  const model = parseFile(text);
  const pre = (model.pre || '').replace(/^kanban-plugin:/m, 'tugtile-plugin:');
  const src = model.settings || {};
  const clean = {};
  for (const k of TUGTILE_SETTING_KEYS) if (src[k] !== undefined) clean[k] = src[k];
  if (clean['move-tags'] === undefined && src['move-tags-to-card-footer'] !== undefined) clean['move-tags'] = !!src['move-tags-to-card-footer'];
  if (clean['tag-action'] === 'kanban') clean['tag-action'] = 'board';   // Rename the legacy enum value too
  const post = '%% tugtile:settings\n```\n' + JSON.stringify(clean) + '\n```\n%%';
  return serializeFile({ pre, columns: model.columns, archive: model.archive, post, eol: model.eol });
}
/* ===================== /CORE ===================== */

class BoardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filePath = null;
    this._sortables = [];
    this._backedUp = false;
    this._undo = [];   // Pushes the previous file content before writing, used for undo
    this._redo = [];   // Used for redo after an undo operation
  }
  getViewType() { return VIEW_TYPE; }
  getIcon() { return 'gallery-vertical'; }
  getDisplayText() {
    // Tab title = plain file name only (no brand suffix), so narrow tabs show as much of the name as possible.
    // The brand ("· tugtile-ing") lives in the centered header title instead, applied by decorateHeaderTitle().
    return this.filePath ? this.filePath.split('/').pop().replace(/\.md$/, '') : t('appName');
  }
  async setState(state, result) {
    if (state && state.file && state.file !== this.filePath) { this.filePath = state.file; this.viewMode = null; this._undo = []; this._redo = []; this.updateUndoRedoActions(); this.leaf.updateHeader && this.leaf.updateHeader(); }   // Change file → reset view and undo/redo stacks, and refresh header (updating the header title from the fallback app name to the file name)
    this.watchHeaderTitle(); this.decorateHeaderTitle();
    await this.render();
    return super.setState(state, result);
  }
  getState() { return { file: this.filePath }; }
  // The centered header title shows "<file name> · tugtile-ing" with the brand part dimmed.
  // Obsidian rewrites this element from getDisplayText() (plain file name) on every updateHeader, so we re-append the brand span and keep it in sync via a MutationObserver.
  _headerTitleEl() { return this.containerEl ? this.containerEl.querySelector('.view-header-title') : null; }
  // The centered header is the view switcher: "<current view icon> <current view name> · tugtile-ing".
  // The file name is NOT repeated here (the tab already shows it). Obsidian rewrites this element from getDisplayText() on every updateHeader, so we rebuild via a MutationObserver.
  // Builds the centered control — [view-cycle button] · [lock button] — into a parent. The "·" is a neutral
  // separator (not a button); equal button padding + a single gap make its two sides symmetric.
  _buildHeaderCtl(parent) {
    const wrap = parent.createSpan({ cls: 'tugtile-headerctl' });
    const vc = wrap.createSpan({ cls: 'tugtile-viewcycle' });
    vc.setAttribute('role', 'button');
    vc.setAttribute('aria-label', t('viewSwitchAction'));
    vc.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.cycleView(); };
    this._viewCycleEl = vc;
    wrap.createSpan({ cls: 'tugtile-sep', text: '·' });
    const lk = wrap.createSpan({ cls: 'tugtile-brand' });   // Brand suffix + lock icon = the lock toggle
    lk.setAttribute('role', 'button');
    lk.setAttribute('aria-label', t('lockToggle'));
    lk.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.toggleLock(); };
    this._lockBtnEl = lk;
    this.refreshViewCycle();
    this.refreshLock();
    return wrap;
  }
  decorateHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el) return;
    // Phone: the control + brand live in the content top-bar, so keep the header title empty — otherwise the
    // view's app-name fallback ("理牌") shows there redundantly. Re-cleared by the MutationObserver.
    if (Platform.isPhone) { if (el.textContent !== '') el.textContent = ''; return; }
    if (el.querySelector('.tugtile-headerctl')) return;   // Already built; skip (also prevents MutationObserver loops). When Obsidian wipes it on updateHeader, our wrapper is gone → we rebuild.
    el.textContent = '';
    this._buildHeaderCtl(el);
  }
  viewName() { return ({ board: t('viewBoard'), table: t('viewTable') })[this.viewMode] || t('viewBoard'); }
  refreshViewCycle() {
    const btn = this._viewCycleEl; if (!btn || !btn.isConnected) return;
    btn.empty();
    setIcon(btn.createSpan({ cls: 'tugtile-viewcycle-icon' }), this.viewIcon());
    btn.createSpan({ cls: 'tugtile-viewcycle-name', text: this.viewName() });
  }
  // Brand suffix reflects lock state: unlocked = t('brandSuffix') + open padlock; locked = t('brandSuffixLocked') + closed padlock
  refreshLock() {
    const lk = this._lockBtnEl; if (!lk || !lk.isConnected) return;
    lk.empty();
    lk.createSpan({ cls: 'tugtile-brand-text', text: this._locked ? t('brandSuffixLocked') : t('brandSuffix') });
    setIcon(lk.createSpan({ cls: 'tugtile-lock-icon' }), this._locked ? 'lock' : 'lock-open');
    if (this._mdActionEl) this._mdActionEl.toggleClass('tugtile-act-off', this._locked);   // Grey out raw-markdown editing while locked
  }
  // Cycle the centered control between the two resting views (markdown is no longer a view — it's the raw editor button next to this control)
  cycleView() {
    const order = ['board', 'table'];
    this.setView(order[(order.indexOf(this.viewMode) + 1) % order.length]);
  }
  // Raw markdown: open the whole-file editor in the full-screen modal (no resting view); on save it re-renders the current board/table
  openMarkdownEditor() {
    if (this._lockGuard()) return;
    new TileEditModal(this.app, this, { text: this._loadedText || '', onSave: (v) => this.applyMarkdownEdit(v) }).open();
  }
  // Per-board read-only lock: blocks all content mutation (drag, edit, type, add/delete/check/rename) while still allowing view-only actions (switch view, collapse/fold, search). Persisted in board settings.
  _lockGuard() { if (this._locked) { new Notice(t('lockedNotice')); return true; } return false; }
  toggleLock() {
    this._locked = !this._locked;
    this.model.post = setSetting(this.model.post, 'tugtile-locked', this._locked);
    this.contentEl.toggleClass('tugtile--locked', this._locked);
    this._sortables.forEach((s) => { try { s.option('disabled', this._locked); } catch (e) {} });   // Disable drag-and-drop
    this.refreshLock();
    this.persistModel();   // Settings-only write (serializes the in-sync model), safe in any view
  }
  watchHeaderTitle() {
    const el = this._headerTitleEl();
    if (!el || this._titleObserver) return;
    this._titleObserver = new MutationObserver(() => this.decorateHeaderTitle());   // Obsidian resets textContent on updateHeader → re-apply the brand span
    this._titleObserver.observe(el, { childList: true });
    this.decorateHeaderTitle();
  }
  // Relocate Search/Undo/Redo into the header's LEFT area (the dead back/forward arrows are hidden via CSS). Defensive: if the header isn't found (a different mobile layout), the buttons simply stay in the right cluster — no breakage.
  setupLeftActions() {
    if (this._leftActs && this._leftActs.isConnected) return;
    const header = this.containerEl && this.containerEl.querySelector('.view-header');
    if (!header) return;
    // Reuse the native back/forward container (already aligned with the left-sidebar toggle): clear the dead arrows, drop our buttons in. Fall back to a new container if it's absent.
    const nav = header.querySelector('.view-header-nav-buttons');
    const left = nav || header.createDiv({ cls: '' });
    if (!nav) header.insertBefore(left, header.firstChild);
    left.empty();
    left.addClass('tugtile-leftacts');
    [this._searchActionEl, this._undoActionEl, this._redoActionEl, this._backupActionEl].forEach((el) => { if (el) left.appendChild(el); });   // L→R: search, undo, redo, backup
    this._leftActs = left;
    this._alignLeftActs();
  }
  // Pixel-align the first left button with the left-sidebar toggle above it (the tab bar and the view header have slightly different left insets, which vary by platform — so measure rather than guess).
  _alignLeftActs() {
    const left = this._leftActs, first = this._searchActionEl;
    if (!left || !first) return;
    setTimeout(() => {
      if (!first.isConnected) return;
      const fr = first.getBoundingClientRect();
      // Class-independent: the reference is the left-most clickable icon in the bar ABOVE our header (the tab/title bar) — i.e. the sidebar toggle. Measure its left and pad to match.
      let refLeft = Infinity;
      document.querySelectorAll('.clickable-icon, .sidebar-toggle-button').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.bottom <= fr.top + 1 && r.left < 140 && r.left < refLeft) refLeft = r.left;
      });
      if (refLeft === Infinity) return;   // nothing found → keep the CSS fallback nudge
      left.style.paddingLeft = '';        // reset before measuring our own position cleanly
      const d = refLeft - first.getBoundingClientRect().left;
      if (d > 0.5 && d < 48) left.style.paddingLeft = Math.round(d) + 'px';
    }, 60);
  }
  async onOpen() {
    // Right cluster, L→R (addAction renders in REVERSE of registration, so register right-to-left):
    // [undo · redo · search] [fold-all cycle] [open-in-marktile] [Archive] [Settings]. No group gaps (flush).
    this.addAction('settings', t('boardSettingsAction'), () => this.openBoardSettings());
    this.addAction('archive', t('archiveAction'), () => this.openArchiveView());
    // Raw-markdown editor button. marktile IS the extracted editor, so when it's installed it replaces the
    // built-in one (no reason to show both); otherwise fall back to the in-app TileEditModal whole-file editor.
    if (this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('marktile')) {
      this._mdActionEl = this.addAction('square-m', t('openInMarktile'), () => { if (this.filePath) this.leaf.setViewState({ type: 'marktile-editor', active: true, state: { file: this.filePath } }); });
    } else {
      this._mdActionEl = this.addAction('file-text', t('editMarkdown'), () => this.openMarkdownEditor());
    }
    // Single 3-state cycle button (no per-axis lane/tile toggles): maximize-2 (expand lanes only) → expand (expand
    // everything: lanes + tiles) → shrink (collapse everything) → loop. Icon + label track the NEXT action.
    // refreshFoldIcon() (called by setAll* AND the single-lane/tile togglers) keeps it in sync with the live DOM.
    this._foldAllEl = this.addAction('maximize-2', t('expandAllAction'), () => this.toggleFoldAll());
    this.refreshFoldIcon();
    // Search · Undo · Redo are relocated to the header LEFT (where the dead back/forward arrows were) by setupLeftActions(); created via addAction here so their styling + state refs (grey-out, filter icon) are reused.
    this._searchActionEl = this.addAction('search', t('searchAction'), () => this.openSearch());
    this._redoActionEl = this.addAction('redo', t('redoAction'), () => this.redo());
    this._undoActionEl = this.addAction('undo', t('undoAction'), () => this.undo());
    this._backupActionEl = this.addAction('history', t('backupsAction'), () => this.openBackupView());   // joins the left group (search · undo · redo · backup)
    this.updateUndoRedoActions();
    this.setupLeftActions();
    // ⌘Z undo / ⌘⇧Z (or ⌘Y) redo: only intercepted when this board is the active view and focus is not on an input field (allowing native text undo when editing a card)
    this.registerDomEvent(document, 'keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key || '').toLowerCase() !== 'z' && (e.key || '').toLowerCase() !== 'y') return;
      if (this.app.workspace.getActiveViewOfType(BoardView) !== this) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault(); e.stopPropagation();
      if ((e.key || '').toLowerCase() === 'y' || e.shiftKey) this.redo(); else this.undo();
    });
    // External edits (iCloud sync / other editors) → trigger reload. Postponed if a drag, edit, or write operation is in progress;
    // otherwise, render() will call destroySortables and empty() which disrupts active drags/unsaved edits or writes back incomplete data (losing cards).
    this.registerEvent(this.app.vault.on('modify', async (file) => {
      if (this._writing || !file || file.path !== this.filePath) return;
      let cur; try { cur = await this.app.vault.read(file); } catch (e) { return; }
      if (cur === this._loadedText) return;
      if (this.isBusy()) { this._pendingReload = true; return; }
      this.render();
    }));
    // File renamed or moved → update the tracked path so file operations do not fail
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (oldPath === this.filePath) this.filePath = file.path;
    }));
    // External file deletion → prevent leaving a zombie board view
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file && file.path === this.filePath) { this.filePath = null; this.render(); }
    }));
    this.watchHeaderTitle();
    await this.render();
  }
  onClose() { this.stopAutoScroll(); this.destroySortables(); this.closePopup(); if (this._titleObserver) { this._titleObserver.disconnect(); this._titleObserver = null; } }

  destroySortables() {
    this._sortables.forEach((s) => { try { s.destroy(); } catch (e) {} });
    this._sortables = [];
  }

  // Progressive edge scrolling: during drag, scrolling speeds up as the pointer approaches the container boundary (idle in the center).
  startAutoScroll() {
    this._pointer = null;
    this._onPointer = (e) => {
      const t = (e.touches && e.touches[0]) || e;
      if (t && typeof t.clientX === 'number') this._pointer = { x: t.clientX, y: t.clientY };
    };
    document.addEventListener('pointermove', this._onPointer, { passive: true, capture: true });
    document.addEventListener('touchmove', this._onPointer, { passive: true, capture: true });
    const speed = (dist) => { const d = (SCROLL_EDGE - dist) / SCROLL_EDGE; return d > 0 ? Math.min(1, d) * SCROLL_MAX : 0; };
    this._scrolling = true;
    const step = () => {
      if (!this._scrolling) return;
      const p = this._pointer;
      if (p) {
        const board = this.contentEl.querySelector('.tugtile__board');
        if (board) {
          const bx = board.getBoundingClientRect();
          if (getComputedStyle(board).flexDirection === 'column') board.scrollTop += speed(bx.bottom - p.y) - speed(p.y - bx.top);   // Vertical layout (responsive board on a narrow pane) scrolls vertically
          else board.scrollLeft += speed(bx.right - p.x) - speed(p.x - bx.left);
        }
        const lanes = this.contentEl.querySelectorAll('.tugtile__lane');
        for (let i = 0; i < lanes.length; i++) {
          const lr = lanes[i].getBoundingClientRect();
          if (p.x >= lr.left && p.x <= lr.right) {
            const list = lanes[i].querySelector('.tugtile__list');
            if (list) {
              const sr = list.getBoundingClientRect();
              list.scrollTop += speed(sr.bottom - p.y) - speed(p.y - sr.top);
            }
            break;
          }
        }
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }
  stopAutoScroll() {
    this._scrolling = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._onPointer) {
      document.removeEventListener('pointermove', this._onPointer, { passive: true, capture: true });
      document.removeEventListener('touchmove', this._onPointer, { passive: true, capture: true });
      this._onPointer = null;
    }
  }

  // Busy state (dragging, editing, adding, or renaming) → delays external reloads to prevent layout disruptions
  isBusy() {
    return !!(this._dragging
      || this._editModalOpen   // Editing in the card editor: block external redraws, otherwise an invalid tid saves content to the wrong card (C1)
      || this._promptBar);     // Rename / add-lane prompt bar open: a reload would empty the content and wipe it mid-edit
  }
  consumePendingReload() {
    if (!this._pendingReload || this.isBusy()) return;
    this._pendingReload = false;
    (this._persistChain || Promise.resolve()).then(() => this.render());   // Wait for write queue to clear before reloading to prevent overwrites
  }

  // Re-entrancy lock for render: modification storms, undo operations, and interleaved awaits won't trigger overlapping redraws
  async render() {
    if (this._rendering) { this._renderAgain = true; return; }
    this._rendering = true;
    try { await this._doRender(); this._playViewSwap(); }
    finally {
      this._rendering = false;
      if (this._renderAgain) { this._renderAgain = false; await this.render(); }
    }
  }
  recentlyDragged() { return Date.now() - (this._lastDragEnd || 0) < 250; }   // Guard against simulated click events emitted after dragging/dropping
  // Board⇄table swap animation: the snapshot of the old view (captured in setView) slides up and out while the freshly-rendered view rises from below — like two panels being shuffled. Only runs when setView armed it (not on ordinary redraws).
  _playViewSwap() {
    if (!this._viewSnapHTML) return;
    const root = this.contentEl;
    const snap = root.createDiv({ cls: 'tugtile-viewsnap' });
    snap.innerHTML = this._viewSnapHTML;
    this._viewSnapHTML = null;
    root.addClass('tugtile--switching');
    const cleanup = () => { if (snap.isConnected) snap.remove(); root.removeClass('tugtile--switching'); };
    snap.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 500);   // Fallback in case animationend doesn't fire
  }
  async _doRender() {
    this.closePopup();           // Dismiss date/time dropdown before redraw to prevent orphaned popups
    this._archiveBar = null;     // Dereference old bar since root.empty() destroys it (L2, not rebuilt in table view)
    this._expandedEl = null;     // Reset accordion tracker since redraw detaches old nodes (releases old DOM references)
    this.destroySortables();
    if (this._renderChild) { this.removeChild(this._renderChild); this._renderChild = null; }
    const root = this.contentEl;
    // Preserve scroll across a re-render (e.g. returning from the editor) instead of snapping back to the first tile
    const prevBoard = root.querySelector('.tugtile__board');
    const scrollSnap = prevBoard ? { left: prevBoard.scrollLeft, lanes: Array.from(prevBoard.querySelectorAll('.tugtile__list')).map((l) => l.scrollTop) } : null;
    root.empty();
    root.addClass('tugtile');
    if (!this.filePath) { root.createDiv({ cls: 'tugtile__empty', text: t('emptyNoFile') }); return; }
    this._buildSearchBar(root);   // top-of-content search strip (first child; hidden unless .tugtile--searching), rebuilt each render
    root.toggleClass('tugtile--searching', !!this._searchOpen);
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) { root.createDiv({ cls: 'tugtile__empty', text: t('fileNotFound', this.filePath) }); return; }

    const text = await this.app.vault.read(file);
    this._loadedText = text;       // Cache the loaded disk content to compare before saving, preventing accidental overwrites of external modifications
    this.model = parseFile(text);
    const S = this.plugin.settings || DEFAULT_SETTINGS;
    const bs = this.model.settings || {};
    // Show card checkboxes: follow board settings if explicitly configured; otherwise, default to false, unless a **Complete** lane is present (which indicates an active completion workflow).
    // Rationale: obsidian-kanban format marks every card with `- [ ]` (tasks), so all cards naturally have markers. Displaying checkboxes on content/sorting-only boards is visual noise and conflicts with completion workflows.
    // Global showCheckboxes can still be enabled by the user to force them. If checkboxes are hidden, markers are preserved in files, ensuring compatibility.
    const hasCompleteLane = (this.model.columns || []).some((c) => (c.lead || []).join('\n').indexOf('**Complete**') !== -1);
    this.showCheckbox = (bs['show-checkboxes'] !== undefined) ? (bs['show-checkboxes'] !== false) : (!!S.showCheckboxes || hasCompleteLane);
    // Hide card counts: board setting takes precedence, falls back to global setting
    const hideCounts = (bs['hide-card-count'] === undefined) ? !!S.hideCounts : !!bs['hide-card-count'];
    root.toggleClass('tugtile--hide-counts', hideCounts);
    // Size presets as CSS vars on the root (inherited by both board lanes and table rows, so they work in either view)
    root.style.setProperty('--tugtile-lane-width', (LANE_WIDTHS[S.laneWidth] || LANE_WIDTHS.medium) + 'px');
    root.style.setProperty('--tugtile-row-pad', (TABLE_PADS[S.tableDensity] || TABLE_PADS.medium) + 'px');
    // Date/time configurations (board settings take precedence)
    this.dateTrigger = bs['date-trigger'] || '@';
    this.timeTrigger = bs['time-trigger'] || '@@';
    this.dateFormat = bs['date-format'] || 'YYYY-MM-DD';                          // The date format stored in markdown (for insertion and parsing)
    this.dateDisplayFormat = bs['date-display-format'] || this.dateFormat;        // Date format displayed on the card UI
    this.timeFormat = bs['time-format'] || 'HH:mm';
    this.linkDateToDaily = !!bs['link-date-to-daily-note'];   // Write dates as @[[..]] to link them to daily notes
    this.showRelativeDate = (bs['show-relative-date'] === undefined) ? !!S.showRelativeDate : !!bs['show-relative-date'];
    // Tag configurations (reads color values from kanban-compatible tag-colors; can be moved to footer; click action)
    this.tagColors = {};
    if (Array.isArray(bs['tag-colors'])) bs['tag-colors'].forEach((c) => { if (c && c.tagKey) this.tagColors[c.tagKey] = c; });
    this.moveTagsToFooter = (bs['move-tags'] !== undefined) ? !!bs['move-tags'] : !!bs['move-tags-to-card-footer'];   // The kanban settings key is move-tags
    this.tagAction = bs['tag-action'] || 'board';                               // Default: click a tag to filter this board. Only 'obsidian' triggers a vault-wide search. Legacy value 'board' was 'kanban' (still accepted).
    // Archive settings
    this.archiveHeading = S.archiveHeading || 'Archive';
    this.archiveDateFormat = bs['archive-date-format'] || (this.dateFormat + ' ' + this.timeFormat);
    this.archiveDateSeparator = bs['archive-date-separator'] || '';
    this.appendArchiveDate = !!bs['append-archive-date'];
    this.viewMode = this.viewMode || bs['tugtile-view'] || 'board';
    if (this.viewMode !== 'table') this.viewMode = 'board';   // Only board/table are resting views. 'list' (→ responsive setting) and 'markdown' (→ raw editor button) are retired.
    root.toggleClass('tugtile--rwd', !!S.responsiveBoard);   // Responsive board: auto vertical stack on narrow panes (CSS container query), opt-in via settings (default off)
    this._locked = !!bs['tugtile-locked'];                    // Per-board read-only lock (persisted in board settings)
    root.toggleClass('tugtile--locked', this._locked);
    // Centered control (view-cycle · lock). Desktop/iPad: in the view header. Phone: a top-bar in the content,
    // since the narrow phone header swallows it under the action overflow.
    if (Platform.isPhone) { this._buildHeaderCtl(root.createDiv({ cls: 'tugtile__ctlbar' })); }
    else { this.decorateHeaderTitle(); this.refreshViewCycle(); this.refreshLock(); }
    // Behavior settings: each board can have a custom new-line-trigger (aligned with kanban), falls back to global setting (Enter to submit)
    this.enterSubmits = (bs['new-line-trigger'] !== undefined) ? (bs['new-line-trigger'] !== 'enter') : !!S.enterSubmits;
    const ins = bs['new-card-insertion-method'];   // Board setting takes precedence; prepend/prepend-compact = top, append = bottom
    this.prependNewCards = ins ? (ins === 'append' ? false : true) : !!S.prependNewCards;
    this.archiveWithDate = (bs['archive-with-date'] !== undefined) ? !!bs['archive-with-date'] : !!S.archiveWithDate;
    const cap = bs['max-archive-size'];   // Cap the number of archived cards; drop oldest beyond it. -1 / 0 / unset = unlimited.
    this.maxArchiveSize = (typeof cap === 'number') ? cap : (typeof S.maxArchiveSize === 'number' ? S.maxArchiveSize : -1);
    this.backupRetention = (typeof S.backupRetention === 'number') ? S.backupRetention : 20;   // global — how many backup snapshots to keep per board
    this.allTiles = [];           // Flattened array of cards, indexed by tid (stable across drags)
    this._renderChild = new Component();   // Component hosting markdown sub-resources for this render, unloads as a batch on redraw/close
    this.addChild(this._renderChild);

    // Search runs through a Modal (openSearch), not an inline bar — inline inputs misbehave on iPad. applySearch() below re-applies any active term after a redraw.
    if (this.viewMode === 'table') { this.renderTableView(root); this.applySearch(); return; }
    // Trello-style archive bar at the top: drop cards here to archive (revealed during drag)
    const bar = root.createDiv({ cls: 'tugtile__archivebar' });
    setIcon(bar.createSpan({ cls: 'tugtile__archivebar-i' }), 'archive');
    bar.createSpan({ text: t('dropToArchive') });
    this._archiveBar = bar;
    this._sortables.push(new Sortable(bar, {
      group: 'tugtile', sort: false,
      onAdd: (evt) => {
        const el = evt.item; const tile = this.allTiles[Number(el.dataset.tid)];
        if (tile) this.addToArchive(tile.raw, this._laneName(evt.from && evt.from.closest('.tugtile__lane')));   // evt.from = the lane the card was dragged out of
        el.remove();
        this.renumber();
        this.persist().then(() => this.toastUndo(t('archivedTile')));
      },
    }));
    // Board / List View (List View stacks lanes vertically via CSS, reusing all drag-and-drop and editing logic)
    const collapse = (this.model.settings && this.model.settings['list-collapse']) || [];
    const board = root.createDiv({ cls: 'tugtile__board' });
    board.addEventListener('click', (e) => { if (!e.target.closest('.tugtile__tile')) this.collapseExpanded(); });   // Click blank space to collapse expanded cards
    this.model.columns.forEach((col, i) => this.makeLane(board, col, !!collapse[i]));
    const addCol = board.createDiv({ cls: 'tugtile__addcol' });
    this.renderAddColButton(addCol);
    this.makeBoardSortable(board);
    if (scrollSnap) {   // Restore the pre-render scroll position (horizontal board + each lane's vertical)
      board.scrollLeft = scrollSnap.left;
      board.querySelectorAll('.tugtile__list').forEach((l, i) => { if (scrollSnap.lanes[i] != null) l.scrollTop = scrollSnap.lanes[i]; });
    }
    this.renumber();
    this.applySearch();   // Preserve active search terms after redraw
    if (this._reopenRaw) {   // Keep the newly saved card expanded to show changes
      const rt = this.allTiles.findIndex((t) => t && t.raw === this._reopenRaw);
      this._reopenRaw = null;
      if (rt >= 0) { const el = board.querySelector('.tugtile__tile[data-tid="' + rt + '"]'); if (el) this.expandCard(el); }
    }
    this.refreshFoldIcon();   // Re-render restores collapse from disk via makeLane (not setAll*), so sync the cycle icon to the live DOM (B1 class)
  }

  // Switch resting view (board / table) and save to settings key tugtile-view
  setView(mode) {
    if (mode === this.viewMode) return;
    this._viewSnapHTML = this.contentEl.innerHTML;   // Snapshot the outgoing view for the swap animation (_playViewSwap)
    this.viewMode = mode;
    this.refreshViewCycle();
    this.model.post = setSetting(this.model.post, 'tugtile-view', mode);
    this.persistModel().then(() => this.render());   // Save settings and reload view to keep model and disk in sync
  }
  // Whole-file save from the markdown editor modal: write the raw text, then re-render (re-parses the board model)
  async applyMarkdownEdit(text) {
    await this._write(text);
    this._loadedText = text;
    await this.render();
    new Notice(t('saved'));
  }
  // Table View: lists all cards with details (card text, lane, date, tags). Supports column sorting, row-based editing, and toggling checkboxes.
  renderTableView(root) {
    const wrap = root.createDiv({ cls: 'tugtile__table-wrap' });
    const table = wrap.createEl('table', { cls: 'tugtile__table' });
    const htr = table.createEl('thead').createEl('tr');
    [t('colTile'), t('colLane'), t('colDate'), t('colTags')].forEach((h, ci) => { const th = htr.createEl('th', { text: h }); th.onclick = () => this.sortTable(ci); });
    const tbody = table.createEl('tbody');
    this.model.columns.forEach((col, colIdx) => (col.tiles || []).forEach((tile, ti) => {
      const tid = this.allTiles.push(tile) - 1;
      const meta = extractMeta(tile.text, this.dateTrigger, this.timeTrigger);
      const tr = tbody.createEl('tr', { cls: 'tugtile__row' });
      tr.dataset.tid = String(tid); tr.dataset.col = String(colIdx); tr.dataset.ti = String(ti);
      const c1 = tr.createEl('td', { cls: 'tugtile__row-title' });
      if (this.showCheckbox) { const cb = c1.createEl('input', { type: 'checkbox' }); cb.checked = !!(tile.check && tile.check !== ' '); cb.onclick = (ev) => { ev.stopPropagation(); this.toggleCheckModel(colIdx, ti, cb); }; }
      const span = c1.createSpan({ cls: 'tugtile__row-text', text: tilePlainText(meta.clean.split('\n')[0] || '') });   // Render as plain text; styles are managed entirely by the application (prevents unparsed markdown from cluttering the table)
      c1.onclick = (ev) => { if (ev.target.closest('input, a')) return; this.editRow(tr, colIdx, ti); };
      tr.createEl('td', { cls: 'tugtile__row-lane', text: parseWip(col.title || '').title });
      const c3 = tr.createEl('td', { cls: 'tugtile__row-date' });
      if (meta.date) { const s = c3.createSpan({ text: this.formatDate(meta.date) }); const cls = this.dateClass(meta.date); if (cls) s.className = cls; }
      const c4 = tr.createEl('td', { cls: 'tugtile__row-tags' });
      extractTags(tile.text).forEach((t) => { const chip = c4.createSpan({ cls: 'tugtile__tag', text: t }); const c = this.tagColors[t]; if (c) { if (c.backgroundColor) chip.style.backgroundColor = c.backgroundColor; if (c.color) chip.style.color = c.color; } chip.onclick = (ev) => { ev.stopPropagation(); this.onTagClick(t); }; });
    }));
  }
  sortTable(ci) {
    const tbody = this.contentEl.querySelector('.tugtile__table tbody');
    if (!tbody) return;
    const dir = (this._tableSort && this._tableSort.ci === ci) ? -this._tableSort.dir : 1;
    this._tableSort = { ci, dir };
    const val = (tr) => {
      const t = this.allTiles[Number(tr.dataset.tid)] || {};
      if (ci === 1) return tr.querySelector('.tugtile__row-lane').textContent || '';
      if (ci === 2) return extractMeta(t.text || '', this.dateTrigger, this.timeTrigger).date || '￿';
      if (ci === 3) return extractTags(t.text || '')[0] || '￿';
      return (t.text || '').split('\n')[0];
    };
    Array.from(tbody.querySelectorAll('tr')).sort((a, b) => dir * val(a).localeCompare(val(b), 'zh-Hant')).forEach((tr) => tbody.appendChild(tr));
  }
  toggleCheckModel(col, ti, cb) {
    if (this._lockGuard()) { cb.checked = !cb.checked; return; }   // Revert the optimistic checkbox toggle when locked
    const tile = this.model.columns[col].tiles[ti];
    const now = /^- \[ \]/.test(tile.raw) ? 'x' : ' ';
    this.model.columns[col].tiles[ti] = { raw: tile.raw.replace(/^- \[.\]/, '- [' + now + ']'), text: tile.text, check: now, block: tile.block };
    cb.checked = (now === 'x');
    this.persistModel();
  }
  // Table row edit → the same full-screen modal as board cards (consistent, keyboard-safe, clear save/cancel). Table view has no lane DOM, so it saves via the model (persistModel), not the DOM-based persist().
  editRow(tr, col, ti) {
    if (this._lockGuard()) return;
    const tile = this.model.columns[col] && this.model.columns[col].tiles[ti];
    if (!tile) return;
    new TileEditModal(this.app, this, {
      text: tile.text,
      onSave: (v) => {
        const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
        this.model.columns[col].tiles[ti] = { raw: this.buildRaw(v, marker, tile.block), text: v, check: marker, block: tile.block };
        this.persistModel().then(() => this.render());
      },
    }).open();
  }

  // Drag-and-drop sorting for lanes (using lane header as handle, separate sortable group from cards; add lane button stays pinned to the end)
  makeBoardSortable(board) {
    this._sortables.push(new Sortable(board, {
      group: 'tugtile-lanes',
      draggable: '.tugtile__lane',
      handle: '.tugtile__lane-head',
      filter: '.tugtile__addcol',
      animation: 150,
      ...DRAG_TOUCH,   // lane drag now matches the tile: a still tap/long-press to rename isn't hijacked into a drag
      ghostClass: 'tugtile__lane--ghost',
      chosenClass: 'tugtile__lane--chosen',
      dragClass: 'tugtile__lane--drag',
      onMove: (evt) => !(evt.related && evt.related.classList.contains('tugtile__addcol')),  // Prevent lanes from being placed after the "Add Lane" button
      onStart: () => { this._dragging = true; this.closeOpenMenu(); this.startAutoScroll(); },
      onEnd: () => { this.stopAutoScroll(); this._lastDragEnd = Date.now(); this._dragging = false; this.persist(); this.consumePendingReload(); },
    }));
  }

  // Search via a Modal (iPad-safe; inline inputs misbehave there). ✓ applies, ✕ clears, and typing filters live (visible once the modal closes).
  // Search is an in-content bar (not a Modal): reveal the strip the view renders at its top, taking over the
  // control row. The bar is rebuilt every render (_buildSearchBar); here we just toggle visibility + focus.
  openSearch() {
    this._closePromptBar();   // mutual exclusion — never two text bars stacked (that re-opens the keyboard black gap)
    if (this._searchOpen) { this._focusSearch(); return; }   // already open (e.g. icon tapped again) → re-focus
    this._searchOpen = true;
    this.contentEl.addClass('tugtile--searching');
    this.freezeBoard();   // AFTER the bar takes its space, BEFORE the keyboard opens: pin the board height so the
                          // virtual keyboard can't collapse it into a black gap (same fix the old search Modal used)
    if (this._searchInp) this._searchInp.setText(this._searchTerm || '');
    this._focusSearch();
    this._armBarDismiss();
    this.refreshSearchIcon();
  }
  _focusSearch() { this._focusSelect(this._searchInp); }
  _focusSelect(inp) {
    if (!inp) return;
    setTimeout(() => {   // contenteditable has no .select(); focus then range-select its contents
      inp.focus();
      const r = document.createRange(); r.selectNodeContents(inp);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }, 0);
  }
  closeSearch(clear) {
    this._searchOpen = false;
    this.contentEl.removeClass('tugtile--searching');
    this.unfreezeBoard();   // release the pinned height so the board reflows back to normal
    const inp = this._searchInp;
    if (clear) { this._searchTerm = ''; if (inp) inp.setText(''); this.applySearch(); }   // ✕ / Escape: drop the filter
    if (inp) inp.blur();
    this.refreshSearchIcon();
  }
  // Shared row for every in-content text bar (search · rename · add-lane): the rounded field with an optional
  // leading icon, a plaintext-only contenteditable (dodges Obsidian's input chrome, CJK-safe), and ✕ / ✓ buttons.
  // The taps preventDefault to keep focus → the virtual keyboard stays open → single-tap action (editor pattern).
  // onFinish(true) = submit (✓ / Enter); onFinish(false) = cancel (✕ / Escape). Returns the input element.
  _buildPromptRow(container, opts) {
    const row = container.createDiv({ cls: 'tugtile-prompt-row' });
    const field = row.createDiv({ cls: 'tugtile-prompt-field' });
    if (opts.icon) setIcon(field.createSpan({ cls: 'tugtile-prompt-fieldicon' }), opts.icon);
    const inp = field.createDiv({ cls: 'tugtile-prompt-input', attr: { contenteditable: 'plaintext-only', role: opts.role || 'textbox', spellcheck: 'false' } });
    inp.setText(opts.value || '');
    if (opts.placeholder) inp.dataset.placeholder = opts.placeholder;
    if (opts.onInput) inp.addEventListener('input', () => opts.onInput(inp.textContent));
    const tap = (el, fn) => {
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('pointerdown', (e) => e.preventDefault());
      el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
      el.addEventListener('click', fn);
    };
    const x = row.createEl('button', { cls: 'tugtile-iconbtn tugtile-prompt-x' }); setIcon(x.createSpan(), 'x'); x.setAttribute('aria-label', t('cancel'));
    const ok = row.createEl('button', { cls: 'tugtile-iconbtn tugtile-prompt-ok' }); setIcon(ok.createSpan(), 'check'); ok.setAttribute('aria-label', t('save'));
    tap(x, () => opts.onFinish(false));
    tap(ok, () => opts.onFinish(true));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !(e.isComposing || e.keyCode === 229)) { e.preventDefault(); opts.onFinish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); opts.onFinish(false); }
    });
    return inp;
  }
  // The in-content search bar. Rebuilt each render (root.empty destroys it), hidden until .tugtile--searching.
  _buildSearchBar(root) {
    const bar = root.createDiv({ cls: 'tugtile-searchbar' });
    this._searchInp = this._buildPromptRow(bar, {
      value: this._searchTerm || '', placeholder: t('searchPlaceholder'), icon: 'search', role: 'searchbox',
      onInput: (v) => { this._searchTerm = v; this.applySearch(); },
      onFinish: (save) => this.closeSearch(!save),   // ✓/Enter keep the filter; ✕/Escape clear it
    });
    return bar;
  }
  // Transient top prompt bar for rename / add-lane (replaces the old PromptModal). Same proven recipe as search —
  // a top strip + freezeBoard — so the iPad keyboard can't collapse the board into a black gap (the documented
  // reason these two were Modals). One-shot: built on demand, removed on finish; isBusy() blocks external reloads
  // while it's open so it can't be wiped mid-edit.
  _openPromptBar(opts) {
    if (this._searchOpen) this.closeSearch(false);   // mutual exclusion — keep any active filter, just drop the bar
    this._closePromptBar();
    const root = this.contentEl;
    const bar = root.createDiv({ cls: 'tugtile-promptbar' });
    root.prepend(bar);   // top of content (above the board / control strip)
    root.addClass('tugtile--prompting');
    this._promptBar = bar;
    const inp = this._buildPromptRow(bar, {
      value: opts.value || '', placeholder: opts.placeholder, icon: opts.icon || 'pencil',
      onFinish: (save) => { const v = inp.textContent; this._closePromptBar(); if (save && opts.onSubmit) opts.onSubmit(v); },
    });
    this.freezeBoard();
    this._focusSelect(inp);
    this._armBarDismiss();
  }
  _closePromptBar() {
    if (this._promptBar) { this._promptBar.remove(); this._promptBar = null; }
    this.contentEl.removeClass('tugtile--prompting');
    this.unfreezeBoard();
  }
  // Tap/click anywhere off an open text bar dismisses it (search keeps its filter; a rename/add-lane prompt is
  // cancelled — no submit). Registered once on first use (auto-removed on view unload). Capture phase so it runs
  // before the tapped element's own handler, which also guarantees one bar at a time (opening another closes this).
  _armBarDismiss() {
    if (this._barDismissArmed) return;
    this._barDismissArmed = true;
    this.registerDomEvent(document, 'pointerdown', (e) => this._maybeDismissBar(e), true);
  }
  _maybeDismissBar(e) {
    if (this._promptBar) { if (!this._promptBar.contains(e.target)) this._closePromptBar(); return; }
    if (this._searchOpen) {
      const bar = this.contentEl.querySelector('.tugtile-searchbar');
      if (bar && !bar.contains(e.target)) this.closeSearch(false);
    }
  }
  applySearch() {
    const term = (this._searchTerm || '').toLowerCase();
    this.contentEl.querySelectorAll('.tugtile__tile, .tugtile__row').forEach((el) => {   // Filters both cards and table rows
      const t = this.allTiles[Number(el.dataset.tid)];
      const hit = !term || (t && t.text.toLowerCase().indexOf(term) !== -1);
      el.style.display = hit ? '' : 'none';
    });
    this.refreshSearchIcon();
  }
  refreshSearchIcon() { if (this._searchActionEl) setIcon(this._searchActionEl, (this._searchTerm || '') ? 'filter' : 'search'); }   // Icon hints an active filter (no inline bar to show the term anymore)

  // Lane collapse/expand state (written back to settings key list-collapse)
  toggleCollapse(laneEl) {
    const now = laneEl.dataset.collapsed !== 'true';
    laneEl.dataset.collapsed = now ? 'true' : 'false';   // Data state is immediate (persist reads dataset.collapsed); only the visuals below are staged
    if (laneEl._collapseTimer) { clearTimeout(laneEl._collapseTimer); laneEl._collapseTimer = null; }
    const D1 = 260, D2 = 240;                            // Keep in sync with --tg-d1 / --tg-d2 in styles.css
    const reflow = () => laneEl.offsetWidth;             // Force a reflow so the next class change starts a fresh transition
    if (now) {
      // COLLAPSE — stage 1: narrow the lane and tuck the horizontal title into the chevron (head still a row)
      laneEl.classList.remove('tugtile__lane--grown');
      laneEl.classList.add('tugtile__lane--narrowing');
      laneEl._collapseTimer = setTimeout(() => {
        // stage 2: become the vertical strip, then grow the vertical title down out of the chevron
        laneEl.classList.add('tugtile__lane--collapsed');
        laneEl.classList.remove('tugtile__lane--narrowing');
        reflow();
        laneEl.classList.add('tugtile__lane--grown');
        laneEl._collapseTimer = null;
      }, D1);
    } else {
      // EXPAND — stage 1: retract the vertical title up into the chevron. A keyframe drives it (removing --grown
      // alone snaps instead of transitioning — it lacks the committed "from" state the grow path gets via reflow).
      laneEl.classList.remove('tugtile__lane--grown');
      laneEl.classList.add('tugtile__lane--retracting');
      laneEl._collapseTimer = setTimeout(() => {
        // stage 2: back to a row, widen the lane and grow the horizontal title back out
        laneEl.classList.remove('tugtile__lane--retracting');
        laneEl.classList.add('tugtile__lane--narrowing');
        laneEl.classList.remove('tugtile__lane--collapsed');
        reflow();
        laneEl.classList.remove('tugtile__lane--narrowing');
        laneEl._collapseTimer = null;
      }, D2);
    }
    this.persist();
    this.refreshFoldIcon();   // single-lane collapse changed the fold state → resync the cycle button (B1)
  }

  // Renders a lane (toggles collapse with chevron, supports clickable title renaming and deletion; renders cards via makeTileEl, appends card creator at the bottom)
  makeLane(board, col, collapsed) {
    const laneEl = board.createDiv({ cls: 'tugtile__lane' });
    laneEl.dataset.header = col.header || ('## ' + (col.title || ''));
    laneEl.dataset.lead = (col.lead || []).join('\n');   // Persist lane lead text with the lane data, preserved across file writes
    laneEl.dataset.collapsed = collapsed ? 'true' : 'false';
    if (collapsed) laneEl.addClasses(['tugtile__lane--collapsed', 'tugtile__lane--grown']);   // grown: vertical title shown at rest (no entry animation when rendering an already-collapsed lane)
    const head = laneEl.createDiv({ cls: 'tugtile__lane-head' });
    head.tabIndex = 0;   // focusable → Tab/Shift+Tab reaches the lane header (alongside cards) → keyboard lane reorder (←/→) + accessibility; mirrors the focusable card div (makeTileEl)
    head.addEventListener('keydown', (e) => {
      if (e.target !== head) return;   // only when the header bar itself is focused, not an input inside it (e.g. the inline rename field) — matches the card handler's e.target===tileEl guard
      if (e.isComposing || e.keyCode === 229) return;   // never hijack IME composition (parity with the card, editor, and card-submit guards)
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;   // only ←/→ reorder; leave Enter/etc. to fall through to any existing header behaviour. ↑/↓ are intentionally out of scope for now.
      e.preventDefault();
      if (this._lockGuard()) return;
      if (this._keyMoveLane(laneEl, e.key)) head.focus();   // keep focus on the lane header as it travels (DOM-direct move keeps this same node alive — no re-render)
    });
    const chevron = head.createSpan({ cls: 'tugtile__lane-chevron' });   // A button-sized hit target wrapping the glyph; only the inner glyph rotates on collapse (CSS), keeping the button still and easy to tap
    chevron.setAttribute('role', 'button');
    chevron.setAttribute('aria-label', t('collapseExpand'));
    setIcon(chevron.createSpan({ cls: 'tugtile__lane-chevron-glyph' }), 'chevron-down');   // Lucide icon (matches the rest of the UI); collapse rotates this glyph -90° via CSS to point right
    chevron.onclick = (e) => { if (this.recentlyDragged()) return; e.stopPropagation(); this.toggleCollapse(laneEl); };
    const wip = parseWip(col.title || '');
    laneEl.dataset.wip = wip.max == null ? '' : String(wip.max);   // Persist WIP limit with the lane data, restored during renaming
    const title = head.createSpan({ cls: 'tugtile__lane-title', text: wip.title });
    title.onclick = () => { if (this.recentlyDragged()) return; if (laneEl.dataset.collapsed === 'true') this.toggleCollapse(laneEl); else this.startRenameColumn(laneEl, title); };
    const titleV = head.createSpan({ cls: 'tugtile__lane-title-v', text: wip.title });   // Vertical clone shown only in the collapsed strip (kept in sync on rename)
    titleV.setAttribute('aria-hidden', 'true');
    titleV.onclick = () => { if (this.recentlyDragged()) return; this.toggleCollapse(laneEl); };
    head.createSpan({ cls: 'tugtile__lane-count', text: '0' });
    const more = head.createSpan({ cls: 'tugtile__lane-more' });
    setIcon(more, 'more-horizontal');
    more.setAttribute('aria-label', t('laneActionsAria'));
    more.onclick = (e) => { if (this.recentlyDragged()) return; e.stopPropagation(); this.openLaneMenu(e, laneEl); };
    // The lane delete button (✕) has been moved to the more actions menu (⋯)
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.openLaneMenu(e, laneEl); });
    const list = laneEl.createDiv({ cls: 'tugtile__list' });
    (col.tiles || []).forEach((tile) => this.makeTileEl(list, tile));
    this.makeSortable(list);
    const footer = laneEl.createDiv({ cls: 'tugtile__add' });
    this.renderAddButton(footer, list);
    return laneEl;
  }

  makeSortable(list) {
    this._sortables.push(new Sortable(list, {
      group: 'tugtile',
      disabled: !!this._locked,   // No drag-and-drop while the board is locked
      animation: 150,
      ...DRAG_TOUCH,   // shared touch tuning (see DRAG_TOUCH) — long-press + tremor tolerance, identical to the lanes
      scroll: false,
      ghostClass: 'tugtile__tile--ghost',
      chosenClass: 'tugtile__tile--chosen',
      dragClass: 'tugtile__tile--drag',
      onStart: () => { this._dragging = true; this.closeOpenMenu(); if (this._archiveBar) this._archiveBar.style.display = 'flex'; this.startAutoScroll(); },
      onEnd: (evt) => {
        this.stopAutoScroll(); this._lastDragEnd = Date.now(); this._dragging = false;
        if (this._archiveBar) this._archiveBar.style.display = 'none';
        if (evt && evt.to === this._archiveBar) { this.consumePendingReload(); return; }   // Card archiving is already handled by bar.onAdd, do not duplicate (L1)
        this.applyCompleteLane(evt && evt.item, evt && evt.from, evt && evt.to);   // Bi-directional completion lane logic: checking on drag-in, unchecking on drag-out
        this.persist(); this.consumePendingReload();
      },
    }));
  }
  // Header action icon reflecting the active view, so the toolbar button mirrors what is currently shown
  viewIcon() { return ({ board: 'gallery-vertical', table: 'table' })[this.viewMode] || 'gallery-vertical'; }
  // Invariant: tiles can't be expanded while lanes are collapsed — so when lanes are collapsed, everything is shut.
  _foldState() {   // read the LIVE DOM (reflects manual single-lane/tile ops), then the pure foldStateFrom decides 0/1/2
    const lanes = this.contentEl.querySelectorAll('.tugtile__lane');
    const allLanesCollapsed = lanes.length > 0 && Array.from(lanes).every((l) => l.dataset.collapsed === 'true');
    const longs = Array.from(this.contentEl.querySelectorAll('.tugtile__tile')).filter((el) => el.dataset.long === 'true');
    return foldStateFrom(allLanesCollapsed, longs.every((t) => !t.classList.contains('tugtile__tile--folded')));
  }
  refreshFoldIcon() {
    if (!this._foldAllEl) return;
    const next = nextFold(this._foldState());   // icon + label = the action the NEXT click performs (matches toggleFoldAll)
    setIcon(this._foldAllEl, FOLD_ICONS[next]);
    this._foldAllEl.setAttribute('aria-label', [t('expandLanesAction'), t('expandAllAction'), t('collapseAllAction')][next]);
  }
  // Sets every long tile's fold state (DOM + tracker + icon)
  setAllCardsExpanded(expanded) {
    this._cardsExpanded = expanded;
    this._expandedEl = null;   // Reset accordion tracker since redraw detaches old nodes (releases old DOM references)
    this.contentEl.querySelectorAll('.tugtile__tile').forEach((el) => {
      if (el.dataset.long !== 'true') return;
      el.classList.toggle('tugtile__tile--folded', !expanded);
    });
    this.refreshFoldIcon();
  }
  // Sets every lane's collapse state (DOM + tracker + icon), without persisting — callers decide when to save.
  // Snaps straight to the resting state (the lane width still transitions); the two-stage choreography is for
  // single-lane toggles, where animating 7 lanes at once would just be noisy.
  setAllLanesCollapsed(collapsed) {
    this._lanesCollapsed = collapsed;
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((el) => {
      if (el._collapseTimer) { clearTimeout(el._collapseTimer); el._collapseTimer = null; }   // Cancel any in-flight single-lane animation
      el.dataset.collapsed = collapsed ? 'true' : 'false';
      el.classList.remove('tugtile__lane--narrowing');
      el.classList.toggle('tugtile__lane--collapsed', collapsed);
      el.classList.toggle('tugtile__lane--grown', collapsed);   // grown must track collapsed, or the vertical title stays at scaleY(0) (invisible)
    });
    this.refreshFoldIcon();
  }
  // One-click: expand/collapse all long cards. Containment dependency (Lane ▷ Tile, expand half): a tile body is only visible while its lane is open, so expanding tiles first opens any collapsed lanes.
  // Animates a tile's height from a previously measured value to its current (post-swap) height
  _animateHeight(el, fromH) {
    const toH = el.getBoundingClientRect().height;
    if (Math.abs(fromH - toH) < 1) return;
    el.style.overflow = 'hidden';
    el.style.willChange = 'height';   // Hint the compositor before the animating frames start
    el.style.height = fromH + 'px';
    void el.offsetHeight;   // Force reflow so the starting height is committed before the transition runs
    el.style.transition = 'height 0.3s cubic-bezier(.4, 0, .2, 1)';
    el.style.height = toH + 'px';
    let cleaned = false;
    // Only react to THIS element's own height transition. transitionend bubbles from descendants too (tags,
    // rendered markdown), and a child firing first used to snap the height mid-animation — the "stutter" on
    // content-heavy tiles. A timeout backstops the case where transitionend never arrives.
    const done = (e) => {
      if (e && (e.target !== el || e.propertyName !== 'height')) return;
      if (cleaned) return; cleaned = true;
      el.style.height = ''; el.style.overflow = ''; el.style.transition = ''; el.style.willChange = ''; el.removeEventListener('transitionend', done);
    };
    el.addEventListener('transitionend', done);
    setTimeout(done, 360);
  }
  // One-click: collapse/expand all lanes. Containment dependency (collapse half): collapsing a lane hides every tile inside it, so "collapse all lanes" (><) genuinely shuts everything — it collapses all tiles too. (Expanding lanes only reveals the tiles, still collapsed; re-expand them with the tile button.)
  // Header buttons (replace the old per-axis toggles): expand EVERYTHING (lanes + tiles) / collapse EVERYTHING.
  expandAll() {
    this.setAllLanesCollapsed(false);   // unconditional — was gated behind a stale flag, so it no-op'd after manual lane collapse (B1)
    const longs = Array.from(this.contentEl.querySelectorAll('.tugtile__tile')).filter((el) => el.dataset.long === 'true' && el.offsetParent !== null);
    const before = longs.map((el) => el.getBoundingClientRect().height);   // FLIP height animation: measure → set → animate old→new
    this.setAllCardsExpanded(true);
    longs.forEach((el, i) => this._animateHeight(el, before[i]));
    this.persist();
  }
  collapseAll() {
    this.setAllLanesCollapsed(true);   // collapsing lanes hides the tiles, so no tile animation needed
    this.setAllCardsExpanded(false);
    this.persist();
  }
  toggleFoldAll() {   // 3-state cycle: lanes-only (maximize-2) → all-open (expand) → all-collapsed (shrink) → …
    this._applyFoldState(nextFold(this._foldState()));
  }
  _applyFoldState(s) {
    if (s === 1) return this.expandAll();    // all open (keeps the FLIP tile animation)
    if (s === 2) return this.collapseAll();  // all collapsed
    this.setAllLanesCollapsed(false);   // s === 0: lanes open, tiles stay folded. Unconditional — _lanesCollapsed is
    this.setAllCardsExpanded(false);    // a stale memory flag after a fresh render restores collapse from disk (B1 class)
    this.persist();
  }
  isCompleteLane(laneEl) { return !!(laneEl && (laneEl.dataset.lead || '').indexOf('**Complete**') !== -1); }
  setTileCheck(tileEl, mark) {
    const tid = Number(tileEl.dataset.tid);
    const tile = this.allTiles[tid];
    if (!tile) return;
    const cur = /^- \[(.)\]/.exec(tile.raw);
    if (cur && cur[1] === mark) return;
    this.allTiles[tid] = { raw: tile.raw.replace(/^- \[.\]/, '- [' + mark + ']'), text: tile.text, check: mark, block: tile.block };
    const cb = tileEl.querySelector('.tugtile__check'); if (cb) cb.checked = (mark !== ' ');
  }
  // Bi-directional completion lane: dragging a card into a lane containing **Complete** checks the task; dragging it out to a non-complete lane unchecks it (consistent with kanban)
  applyCompleteLane(tileEl, fromList, toList) {
    if (!tileEl) return;
    const destComplete = toList && this.isCompleteLane(toList.closest('.tugtile__lane'));
    const srcComplete = fromList && this.isCompleteLane(fromList.closest('.tugtile__lane'));
    if (destComplete && !srcComplete) this.setTileCheck(tileEl, 'x');
    else if (srcComplete && !destComplete) this.setTileCheck(tileEl, ' ');
  }

  // Prepends the sequence number (.tugtile__num) inside the first child element of the container, displaying it inline before the first line of text
  // (instead of as a floating indicator in the top-left corner). renumber() subsequently updates this element with the actual sequence number.
  prependTileNum(container) {
    if (!container) return null;
    const first = container.firstElementChild || container;
    const num = first.createSpan({ cls: 'tugtile__num', text: '0' });
    first.insertBefore(num, first.firstChild);   // Insert at the very beginning of the first line
    return num;
  }

  // Renders a card (checkbox, more menu ⋯, delete action, click-to-edit, context menu)
  makeTileEl(listEl, tile) {
    const tid = this.allTiles.push(tile) - 1;
    const tileEl = listEl.createDiv({ cls: 'tugtile__tile' });
    tileEl.dataset.tid = String(tid);
    tileEl.tabIndex = 0;   // focusable → keyboard card movement (arrows) + accessibility
    tileEl.addEventListener('keydown', (e) => {
      if (e.target !== tileEl) return;   // only when the card itself is focused, not an input/button inside it
      if (e.isComposing || e.keyCode === 229) return;   // never hijack IME composition: leave Enter/Arrows to candidate confirm/navigation (matches the same guard in the editor + card-submit handlers)
      // Bare-key card actions (full keyboard loop, no mouse). Safe to bind un-modified because the e.target===tileEl
      // check above guarantees focus is on the card div itself — never inside a textarea/input (where these letters must type normally).
      if (e.key === ' ') { e.preventDefault(); this.toggleCheck(tileEl); return; }   // Space toggles completion (same path as the checkbox onclick); preventDefault stops the page from scrolling
      if (e.key === 'a') { e.preventDefault(); this._keyActOnCard(tileEl, () => this.archiveTile(tileEl)); return; }   // 'a' = reversible Archive (the codebase deliberately prefers Archive over Delete; this is the gentler default)
      if (e.key === 'd' || e.key === 'Backspace') { e.preventDefault(); this._keyActOnCard(tileEl, () => this.deleteTile(tileEl)); return; }   // 'd'/Backspace = Delete (still reversible via the undo toast deleteTile shows)
      if (e.key === 'Enter') { e.preventDefault(); this.startEditTile(tileEl); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      if (this._lockGuard()) return;
      if (this._keyMoveCard(tileEl, e.key)) tileEl.focus();   // keep focus on the card as it travels
    });
    // Sequence numbers are no longer floating indicators in the top-left; they are now prepended inline to the card text (see prependTileNum below) to flow with the first line.
    // Controls in the top-right (checkbox/⋯) are contained within a small floating container to allow text wrap, aligning card content to the top and removing empty space.
    const ctrls = tileEl.createDiv({ cls: 'tugtile__tile-ctrls' });
    if (this.showCheckbox) {
      const cb = ctrls.createEl('input', { cls: 'tugtile__check', type: 'checkbox' });
      cb.checked = !!(tile.check && tile.check !== ' ');
      cb.onclick = (e) => { e.stopPropagation(); this.toggleCheck(tileEl); };
    }
    const more = ctrls.createSpan({ cls: 'tugtile__tile-more' });
    setIcon(more, 'more-horizontal');
    more.setAttribute('aria-label', t('tileActionsAria'));
    more.onclick = (e) => { e.stopPropagation(); this.openTileMenu(e, tileEl); };
    // Deletion is no longer a persistent button on the card (moved to more menu ⋯) to encourage reversible "Archiving" over permanent "Deletion"
    const meta = extractMeta(tile.text, this.dateTrigger, this.timeTrigger);
    const body = tileEl.createDiv({ cls: 'tugtile__tile-body' });
    MarkdownRenderer.render(this.app, meta.clean, body, this.filePath, this._renderChild);   // Renders full markdown body (extracted metadata has been removed from clean)
    if (this.moveTagsToFooter) this.moveTagsToFooterDom(tileEl, body);   // Extract a.tag elements from the rendered DOM (retains native links/inline code integrity)
    else this.styleTags(body);
    this.prependTileNum(body);   // Prepend sequence number inline to the first line of the body
    // Long cards: when collapsed, only display the first non-empty line as the title (processed in JS instead of CSS clipping to avoid padding issues)
    // Use displayWidth (visual columns) rather than .length (code units) so the 60-column budget is consistent
    // across scripts: 60 latin chars = width 60 (identical to the previous behaviour), while ~30 CJK chars also
    // reach width 60 — i.e. cards collapse at the same *visual* length regardless of language. Threshold stays
    // at 60 (in display-width units), NOT doubled.
    const isLong = meta.clean.indexOf('\n') !== -1 || displayWidth(meta.clean) > 60;
    tileEl.dataset.long = isLong ? 'true' : 'false';
    if (isLong) {
      const firstLine = (meta.clean.split('\n').find((l) => l.trim() !== '') || meta.clean).trim();
      const titleEl = tileEl.createDiv({ cls: 'tugtile__tile-title' });
      MarkdownRenderer.render(this.app, firstLine, titleEl, this.filePath, this._renderChild);
      this.styleTags(titleEl);
      this.prependTileNum(titleEl);   // Prepends the sequence number to the title line when collapsed
      if (!this._cardsExpanded) tileEl.addClass('tugtile__tile--folded');
    }
    if (meta.date || meta.time) this.renderDateChip(tileEl, meta);
    // Click behavior: expands collapsed long cards (accordion style); opens modal editor for short or already expanded cards
    tileEl.addEventListener('click', (e) => {
      if (Date.now() - (this._lastDragEnd || 0) < 250) return;   // Prevent click misfires immediately after dragging/dropping
      if (e.target.closest('a, input, button, .tugtile__check, .tugtile__tile-more')) return;
      if (tileEl.dataset.long === 'true' && tileEl.classList.contains('tugtile__tile--folded')) { this.expandCard(tileEl); return; }
      this.startEditTile(tileEl);
    });
    tileEl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.openTileMenu(e, tileEl); });
    return tileEl;
  }

  // Applies tag colors and click handlers to rendered .tag elements
  styleTags(container) {
    container.querySelectorAll('a.tag').forEach((el) => {
      const key = el.textContent.trim();
      const c = this.tagColors[key];
      if (c) { if (c.backgroundColor) el.style.backgroundColor = c.backgroundColor; if (c.color) el.style.color = c.color; }
      el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onTagClick(key); });
    });
  }
  onTagClick(tag) {
    if (this.tagAction === 'obsidian') {   // 'obsidian' = search the whole vault; anything else (board / legacy kanban / default) = filter this board
      try { const gs = this.app.internalPlugins.getEnabledPluginById('global-search'); if (gs) { gs.openGlobalSearch('tag:' + tag); return; } } catch (e) {}
    }
    // 'kanban' action or if global-search is disabled: filter the current board directly (the search-action icon flips to indicate the active filter)
    this._searchTerm = tag;
    this.applySearch();
  }
  // Moves rendered a.tag elements to the card footer (extracts from Obsidian's rendering, automatically excluding hash characters inside URLs or inline code)
  moveTagsToFooterDom(tileEl, body) {
    const tagEls = Array.from(body.querySelectorAll('a.tag'));
    if (!tagEls.length) return;
    const ft = tileEl.createDiv({ cls: 'tugtile__tags' });
    tagEls.forEach((a) => {
      const t = a.textContent.trim();
      const chip = ft.createSpan({ cls: 'tugtile__tag', text: t });
      const c = this.tagColors[t];
      if (c) { if (c.backgroundColor) chip.style.backgroundColor = c.backgroundColor; if (c.color) chip.style.color = c.color; }
      chip.onclick = (e) => { e.stopPropagation(); this.onTagClick(t); };
      a.remove();
    });
  }

  // Date/time chip at the card footer (hides raw tokens, displays formatted date, relative time, and applies color based on status)
  renderDateChip(tileEl, meta) {
    const chip = tileEl.createDiv({ cls: 'tugtile__date' });
    if (meta.date) {
      const cls = this.dateClass(meta.date);
      if (cls) chip.addClass(cls);
      let label = this.formatDate(meta.date);
      if (this.showRelativeDate) { const rel = this.relativeDate(meta.date); if (rel) label += t('relDateWrap', rel); }
      const dd = chip.createSpan({ cls: 'tugtile__date-d' });
      setIcon(dd.createSpan({ cls: 'tugtile__date-i' }), 'calendar');
      dd.createSpan({ text: label });
    }
    if (meta.time) { const dt = chip.createSpan({ cls: 'tugtile__date-t' }); setIcon(dt.createSpan({ cls: 'tugtile__date-i' }), 'clock'); dt.createSpan({ text: meta.time }); }
  }
  formatDate(s) {
    const p = parseDateStr(s, this.dateFormat);   // Parse using the board's configured date-format (no longer hardcoded to ISO)
    if (!p) return s;                              // Returns original string if parsing fails
    return formatDateTokens(p, this.dateDisplayFormat);
  }
  _dayDiff(s) {
    const p = parseDateStr(s, this.dateFormat);
    if (!p) return null;
    const d = new Date(p.y, p.mo - 1, p.d); d.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  }
  relativeDate(s) {
    const diff = this._dayDiff(s);
    if (diff === null) return '';
    const map = { 0: t('today'), 1: t('tomorrow'), '-1': t('yesterday'), 2: t('dayAfterTomorrow'), '-2': t('dayBeforeYesterday') };
    if (map[diff] !== undefined) return map[diff];
    return diff > 0 ? t('daysLater', diff) : t('daysAgo', -diff);
  }
  dateClass(s) {
    const diff = this._dayDiff(s);
    if (diff === null) return 'tugtile__date--unknown';   // Date present but unparseable → neutral color (L3)
    if (diff < 0) return 'tugtile__date--overdue';   // Overdue
    if (diff === 0) return 'tugtile__date--today';    // Today (accent)
    if (diff <= 7) return 'tugtile__date--soon';      // Due soon (within 7 days)
    return 'tugtile__date--safe';                     // Safe (any valid date is colored)
  }

  // Attaches datepicker/timepicker listeners triggerable by typing @ or @@ in the textarea
  attachDatePicker(ta) {
    const dt = this.dateTrigger || '@', tt = this.timeTrigger || '@@';
    // Reads cursor location on insert, finding the last trigger character backwards (avoids using stale cursor position from the input event)
    const insert = (trig, token) => {
      const cur = ta.selectionStart;
      const idx = ta.value.slice(0, cur).lastIndexOf(trig);
      const start = idx === -1 ? cur : idx;
      ta.value = ta.value.slice(0, start) + token + ta.value.slice(cur);
      const np = start + token.length;
      ta.setSelectionRange(np, np); ta.focus();
    };
    ta.addEventListener('input', () => {
      const before = ta.value.slice(0, ta.selectionStart);
      const rect = ta.getBoundingClientRect();
      if (before.endsWith(tt)) this.showTimePopup(rect.left + 8, rect.bottom + 4, (t) => insert(tt, tt + '{' + t + '}'));
      else if (before.endsWith(dt)) this.showDatePopup(rect.left + 8, rect.bottom + 4, (val) => insert(dt, this.linkDateToDaily ? dt + '[[' + val + ']]' : dt + '{' + val + '}'));
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._popup) { e.preventDefault(); e.stopPropagation(); this.closePopup(); } }, true);
  }
  closePopup() {
    this._popupClosed = true;
    if (this._popup) { this._popup.remove(); this._popup = null; }
    if (this._popupOutside) { document.removeEventListener('mousedown', this._popupOutside, true); this._popupOutside = null; }
  }
  _popupAt(x, y, cls) {
    this.closePopup();
    this._popupClosed = false;
    const pop = document.body.createDiv({ cls: 'tugtile__popup' + (cls ? ' ' + cls : '') });
    pop.style.left = Math.round(x) + 'px';
    pop.style.top = Math.round(y) + 'px';
    pop.addEventListener('mousedown', (e) => e.preventDefault());   // Prevent selecting menu items from stealing focus from the textarea (avoids triggering blur and premature saving)
    this._popup = pop;
    // Click-outside dismissal: bound to this specific pop element (L2); calls stopPropagation on dismissal to prevent click events from passing through to the modal backdrop, which would close the editor (M3)
    setTimeout(() => {
      if (this._popup !== pop) return;
      this._popupOutside = (ev) => { if (!pop.contains(ev.target)) { ev.stopPropagation(); this.closePopup(); } };
      document.addEventListener('mousedown', this._popupOutside, true);
    }, 0);
    return pop;
  }
  // Clamps the popup position within the viewport boundary (called after measuring contents)
  _clampPopup() {
    const pop = this._popup; if (!pop) return;
    const r = pop.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, window.innerHeight - r.height - 8) + 'px';
  }
  showDatePopup(x, y, onPick) {
    const pop = this._popupAt(x, y);
    const view = new Date(); view.setDate(1); view.setHours(0, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const render = () => {
      pop.empty();
      const head = pop.createDiv({ cls: 'tugtile__popup-head' });
      const prev = head.createSpan({ cls: 'tugtile__popup-nav' }); setIcon(prev, 'chevron-left');
      head.createSpan({ text: t('yearMonth', view.getFullYear(), view.getMonth() + 1) });
      const next = head.createSpan({ cls: 'tugtile__popup-nav' }); setIcon(next, 'chevron-right');
      prev.onclick = () => { view.setMonth(view.getMonth() - 1); render(); };
      next.onclick = () => { view.setMonth(view.getMonth() + 1); render(); };
      const grid = pop.createDiv({ cls: 'tugtile__popup-grid' });
      t('weekdays').forEach((w) => grid.createSpan({ cls: 'tugtile__popup-w', text: w }));
      const y0 = view.getFullYear(), m0 = view.getMonth();
      const startDow = new Date(y0, m0, 1).getDay();
      const days = new Date(y0, m0 + 1, 0).getDate();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (let i = 0; i < startDow; i++) grid.createSpan();
      for (let d = 1; d <= days; d++) {
        const cell = grid.createSpan({ cls: 'tugtile__popup-d', text: String(d) });
        const dd = new Date(y0, m0, d);
        if (+dd === +today) cell.addClass('tugtile__popup-d--today');
        cell.onclick = () => { onPick(formatDateTokens({ y: y0, mo: m0 + 1, d: d }, this.dateFormat)); this.closePopup(); };   // Write back using the board's configured date-format to prevent inconsistent formatting within the same board
      }
    };
    render();
    this._clampPopup();
  }
  showTimePopup(x, y, onPick) {
    const pop = this._popupAt(x, y, 'tugtile__popup--time');
    for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) {
      const t = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      pop.createDiv({ cls: 'tugtile__popup-t', text: t }).onclick = () => { onPick(t); this.closePopup(); };
    }
    this._clampPopup();
  }

  // More options ⋯ / Context menu: card actions menu
  openTileMenu(e, tileEl) {
    if (this._lockGuard()) return;
    if (this._dragging || this.recentlyDragged()) { if (e.preventDefault) e.preventDefault(); return; }   // Don't let a long-press menu fire during / right after a drag
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(t('edit')).setIcon('pencil').onClick(() => this.startEditTile(tileEl)));
    menu.addItem((i) => i.setTitle(t('duplicateTile')).setIcon('copy').onClick(() => this.duplicateTile(tileEl)));
    menu.addItem((i) => i.setTitle(t('insertTileAbove')).setIcon('arrow-up').onClick(() => this.insertTileRelative(tileEl, true)));
    menu.addItem((i) => i.setTitle(t('insertTileBelow')).setIcon('arrow-down').onClick(() => this.insertTileRelative(tileEl, false)));
    const tile0 = this.allTiles[Number(tileEl.dataset.tid)];
    if (tile0 && tile0.text.indexOf('\n') !== -1) {
      menu.addItem((i) => i.setTitle(t('splitTileMenu')).setIcon('split').onClick(() => this.splitTile(tileEl)));
    }
    menu.addItem((i) => i.setTitle(t('archiveTileMenu')).setIcon('archive').onClick(() => this.archiveTile(tileEl)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('moveTileTop')).setIcon('arrow-up-to-line').onClick(() => this.moveTileEdge(tileEl, true)));
    menu.addItem((i) => i.setTitle(t('moveTileBottom')).setIcon('arrow-down-to-line').onClick(() => this.moveTileEdge(tileEl, false)));
    const lanes = Array.from(this.contentEl.querySelectorAll('.tugtile__lane'));
    const curLane = tileEl.closest('.tugtile__lane');
    const laneTitle = (lane) => (lane.dataset.header || '## ').slice(3).trim() || t('untitledLane');
    lanes.filter((l) => l !== curLane).forEach((lane) =>
      menu.addItem((i) => i.setTitle(t('moveToLane', laneTitle(lane))).setIcon('corner-down-right').onClick(() => this.moveTileToLane(tileEl, lane))));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('deleteTileMenu')).setIcon('trash').onClick(() => this.deleteTile(tileEl)));
    this._trackMenu(menu, e); menu.showAtMouseEvent(e);
  }
  // Track the currently-open context menu so a drag (onStart) can dismiss it
  _trackMenu(menu, e) {
    this.closeOpenMenu();
    this._openMenu = menu;
    const p0 = (e && e.touches && e.touches[0]) || e || {};
    const ox = p0.clientX || 0, oy = p0.clientY || 0;
    const onMove = (ev) => { if (ev.pointerType === 'mouse') return; const p = (ev.touches && ev.touches[0]) || ev; if (Math.abs((p.clientX || 0) - ox) > 12 || Math.abs((p.clientY || 0) - oy) > 12) this.closeOpenMenu(); };   // touch/pen drag-to-scroll dismisses the menu; mouse is EXEMPT (otherwise moving toward the popup, always >12px, closed it before you could reach it)
    this._menuMove = onMove;
    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('touchmove', onMove, { capture: true, passive: true });
    menu.onHide(() => { if (this._openMenu === menu) this._openMenu = null; this._detachMenuMove(); });
  }
  _detachMenuMove() { if (this._menuMove) { document.removeEventListener('pointermove', this._menuMove, true); document.removeEventListener('touchmove', this._menuMove, true); this._menuMove = null; } }
  closeOpenMenu() { this._detachMenuMove(); if (this._openMenu) { this._openMenu.hide(); this._openMenu = null; } }

  // Duplicates card: inserts a copy of the card directly below the original
  duplicateTile(tileEl) {
    const tile = this.allTiles[Number(tileEl.dataset.tid)];
    const listEl = tileEl.closest('.tugtile__list');
    // Exclude blockId on copy (block IDs must be unique to prevent broken references for [[#^id]])
    const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
    const raw = tile.block ? this.buildRaw(tile.text, marker, null) : tile.raw;
    const newEl = this.makeTileEl(listEl, { raw, text: tile.text, check: tile.check, block: null });
    tileEl.after(newEl);
    this.persist();
    this.renumber();
  }

  // Inserts a card above/below a reference card (creates empty card → launches editor immediately; discarded only if the editor is cancelled untouched)
  insertTileRelative(tileEl, before) {
    const listEl = tileEl.closest('.tugtile__list');
    if (!listEl) return;
    const newEl = this.makeTileEl(listEl, { raw: this.buildRaw('', ' '), text: '', check: ' ' });
    if (before) tileEl.before(newEl); else tileEl.after(newEl);
    this.renumber();
    this.startEditTile(newEl, true);   // fresh: true (discarded only if cancelled untouched; pressing Save keeps it, blank or not)
  }

  // Splits multi-line card: converts each non-empty line into a separate single-line card (retaining original checkbox markers)
  splitTile(tileEl) {
    const tid = Number(tileEl.dataset.tid);
    const tile = this.allTiles[tid];
    const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
    const lines = tile.text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
    if (lines.length < 2) { new Notice(t('splitNoNeed')); return; }
    const listEl = tileEl.closest('.tugtile__list');
    // Update the first line of the original card in-place (removes raw date tokens via extractMeta, clears previous metadata chip, and redraws)
    this.allTiles[tid] = { raw: this.buildRaw(lines[0], marker, tile.block), text: lines[0], check: marker, block: tile.block };   // Preserve blockId on the first line
    const body = tileEl.querySelector('.tugtile__tile-body');
    const oldChip = tileEl.querySelector('.tugtile__date'); if (oldChip) oldChip.remove();
    if (body) {
      const meta = extractMeta(lines[0], this.dateTrigger, this.timeTrigger);
      body.empty(); MarkdownRenderer.render(this.app, meta.clean, body, this.filePath, this._renderChild);
      if (meta.date || meta.time) this.renderDateChip(tileEl, meta);
    }
    // Subsequent lines are inserted behind sequentially
    let anchor = tileEl;
    for (let i = 1; i < lines.length; i++) {
      const el = this.makeTileEl(listEl, { raw: this.buildRaw(lines[i], marker), text: lines[i], check: marker, block: null });   // Subsequent split lines do not copy blockId (prevents duplicate block IDs)
      anchor.after(el); anchor = el;
    }
    this.persist();
    this.renumber();
    new Notice(t('splitDone', lines.length));
  }

  // Read a lane's display name (the title text, WIP count lives in a separate span) — the key for "restore to home".
  _laneName(laneEl) { const t = laneEl && laneEl.querySelector('.tugtile__lane-title'); return t ? t.textContent : ''; }
  // Tag an archived card's first line with where it came from: a %%tg-home:Lane%% comment (Obsidian hides it; we strip
  // it on restore/display). Inserted before any trailing ^blockId so the blockId stays at the line end.
  _tagHome(line0, lane) {
    const safe = homeKey(lane);
    if (!safe) return line0;
    const tok = ' %%tg-home:' + safe + '%%';
    const bm = /(\s+\^[A-Za-z0-9-]+)$/.exec(line0);
    return bm ? line0.slice(0, bm.index) + tok + bm[0] : line0 + tok;
  }
  // Appends a card's raw content to the archive section: formats timestamp based on kanban settings (format, separator, position), enforces size limit, and creates section with localized header if missing
  addToArchive(raw, homeLane) {
    let entry = raw;
    if (this.archiveWithDate) {
      const lines = raw.split('\n');
      const m = /^(- \[.\] )(.*)$/.exec(lines[0]);
      if (m) {
        const now = new Date();
        const stamp = formatDateTokens({ y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), mi: now.getMinutes() }, this.archiveDateFormat);
        const parts = [stamp];
        if (this.archiveDateSeparator) parts.push(this.archiveDateSeparator);
        parts.push(m[2]);
        if (this.appendArchiveDate) parts.reverse();   // append-archive-date: places the timestamp after the card title
        lines[0] = m[1] + parts.join(' ');
        entry = lines.join('\n');
      }
    }
    if (homeLane) { const ls = entry.split('\n'); ls[0] = this._tagHome(ls[0], homeLane); entry = ls.join('\n'); }   // remember the home lane for restore
    this.model.archive = (this.model.archive && this.model.archive.trim())
      ? this.model.archive.replace(/\s+$/, '') + '\n' + entry
      : '***\n\n## ' + (this.archiveHeading || 'Archive') + '\n\n' + entry;
    this.enforceArchiveCap();
  }
  // Drop the oldest archived cards once the count exceeds max-archive-size (cards append newest-last, so we keep the
  // last N). A cap of -1, 0, or non-positive means unlimited — no trimming.
  enforceArchiveCap() {
    const cap = this.maxArchiveSize;
    if (!(typeof cap === 'number') || cap <= 0) return;
    const { prefix, cards } = this.splitArchive();
    if (cards.length <= cap) return;
    this.model.archive = this.rebuildArchive(prefix, cards.slice(cards.length - cap));   // keep the newest `cap` cards
  }
  // Archives a card: appends to archive and removes from board
  archiveTile(tileEl) {
    this.addToArchive(this.allTiles[Number(tileEl.dataset.tid)].raw, this._laneName(tileEl.closest('.tugtile__lane')));
    tileEl.remove();
    this.renumber();
    this.persist().then(() => this.toastUndo(t('archivedTile')));
  }

  // Moves card to the top/bottom of the lane
  moveTileEdge(tileEl, toTop) {
    const listEl = tileEl.closest('.tugtile__list');
    if (!listEl) return;
    if (toTop) listEl.prepend(tileEl); else listEl.appendChild(tileEl);
    this.persist();
    this.renumber();
  }

  // Moves card to another lane (appended to the bottom)
  moveTileToLane(tileEl, laneEl) {
    if (laneEl === tileEl.closest('.tugtile__lane')) return;
    const listEl = laneEl.querySelector('.tugtile__list');
    if (!listEl) return;
    listEl.appendChild(tileEl);
    this.persist();
    this.renumber();
  }
  // Keyboard card movement: ↑/↓ reorder within the lane, ←/→ hop to the adjacent lane (appended). Returns true if it moved.
  _keyMoveCard(tileEl, key) {
    const list = tileEl.closest('.tugtile__list'); const lane = tileEl.closest('.tugtile__lane');
    if (!list || !lane) return false;
    const isTile = (el) => el && el.classList && el.classList.contains('tugtile__tile');
    if (key === 'ArrowUp') { const prev = tileEl.previousElementSibling; if (!isTile(prev)) return false; list.insertBefore(tileEl, prev); }
    else if (key === 'ArrowDown') { const next = tileEl.nextElementSibling; if (!isTile(next)) return false; list.insertBefore(next, tileEl); }
    else {
      const lanes = Array.from(this.contentEl.querySelectorAll('.tugtile__lane'));
      const target = lanes[lanes.indexOf(lane) + (key === 'ArrowLeft' ? -1 : 1)];
      const tl = target && target.querySelector('.tugtile__list');
      if (!tl) return false;
      tl.appendChild(tileEl);
    }
    this.persist(); this.renumber();
    return true;
  }

  // Keyboard lane movement: ←/→ reorder the focused lane among the other lanes. Returns true if it moved.
  // This deliberately reuses the EXACT drag-reorder path — SortableJS physically relocates the .tugtile__lane node in
  // the board and its onEnd calls this.persist(); _doPersist then derives the new column order from the live DOM
  // (querySelectorAll('.tugtile__lane')). So a keyboard move is the same two steps: relocate the lane node, then
  // persist(). No parallel persistence path, and round-trip fidelity is whatever the drag already guarantees.
  _keyMoveLane(laneEl, key) {
    const isLane = (el) => el && el.classList && el.classList.contains('tugtile__lane');
    if (key === 'ArrowLeft') {
      const prev = laneEl.previousElementSibling;
      if (!isLane(prev)) return false;   // clamp: already the leftmost lane (prev is null or some non-lane node)
      laneEl.parentElement.insertBefore(laneEl, prev);
    } else {   // ArrowRight
      const next = laneEl.nextElementSibling;
      if (!isLane(next)) return false;   // clamp: already the rightmost lane (next is the .tugtile__addcol button, not a lane) — same boundary the drag's onMove guard enforces
      laneEl.parentElement.insertBefore(next, laneEl);
    }
    this.persist();   // identical to the drag onEnd persist — derives new lane order from the DOM
    return true;
  }

  // Runs a destructive keyboard action (archive/delete) on a focused card, then keeps the keyboard loop going by
  // moving focus to a sensible neighbour — otherwise focus falls back to <body> and the user has to grab the mouse
  // to pick another card. Resolve the next target BEFORE the action runs, because the action removes the card from the DOM.
  _keyActOnCard(tileEl, action) {
    if (this._lockGuard()) return;   // archive/delete are blocked while the board is locked, same as the menu paths
    const isTile = (el) => el && el.classList && el.classList.contains('tugtile__tile');
    // Prefer the next card, then the previous card, then the lane itself (lanes aren't focusable, so fall back to its add-card button) so the user lands somewhere useful in the same lane.
    let next = tileEl.nextElementSibling;
    if (!isTile(next)) next = tileEl.previousElementSibling;
    const lane = tileEl.closest('.tugtile__lane');
    const addBtn = lane && lane.querySelector('.tugtile__add-btn');
    action();
    if (isTile(next) && next.isConnected) next.focus();
    else if (addBtn && addBtn.isConnected) addBtn.focus();   // empty lane after the action → land on its "+ Add" button so the user can immediately add the next card
  }

  // Checkbox toggle: modifies the raw checkbox marker directly (preserving all other contents)
  toggleCheck(tileEl) {
    if (this._lockGuard()) return;
    const tid = Number(tileEl.dataset.tid);
    const tile = this.allTiles[tid];
    const cur = /^- \[(.)\]/.exec(tile.raw);
    const now = (cur && cur[1] !== ' ') ? ' ' : 'x';
    const raw = tile.raw.replace(/^- \[.\]/, '- [' + now + ']');
    this.allTiles[tid] = { raw, text: tile.text, check: now, block: tile.block };   // Preserve blockId (M1)
    const cb = tileEl.querySelector('.tugtile__check');
    if (cb) cb.checked = now !== ' ';
    this.persist();
  }

  buildRaw(text, marker, block) {
    // Indentation for wrapped lines follows vault settings (useTab defaults to true → tab; otherwise 4 spaces), aligning with kanban
    const useTab = !(this.app && this.app.vault.getConfig && this.app.vault.getConfig('useTab') === false);
    const indent = useTab ? '\t' : '    ';
    const lines = String(text).split('\n');
    let raw = '- [' + (marker || ' ') + '] ' + (lines[0] || '');
    if (block) raw += ' ^' + block;   // Append blockId back to the end of the first line (hidden from display, preserved in file to prevent broken links)
    for (let i = 1; i < lines.length; i++) raw += '\n' + indent + lines[i];
    return raw;
  }

  // ---- Card Creation ----
  renderAddButton(footer, listEl) {
    footer.empty();
    const btn = footer.createEl('button', { cls: 'tugtile__add-btn', text: t('addTileBtn') });
    btn.onclick = () => this.showAddInput(footer, listEl);
  }
  showAddInput(footer, listEl) {
    if (this._lockGuard()) return;
    // Always use the tile edit modal (supports multiline, bouncy scrolling, and proper virtual keyboard handling; pressing Save keeps the card even when blank, Cancel on an untouched card removes it). footer parameter is retained for compatibility.
    const el = this.makeTileEl(listEl, { raw: this.buildRaw('', ' '), text: '', check: ' ' });
    if (this.prependNewCards && el !== listEl.firstChild) listEl.insertBefore(el, listEl.firstChild);
    this.renumber();
    this.startEditTile(el, true);   // fresh: true (discarded only if cancelled untouched; pressing Save keeps it, blank or not)
  }
  // Host callback for the editor core (editor-core.js calls host.isSubmitKey): does this keydown commit the card?
  // Mobile: Enter always inserts a newline (commit via the ✓ button); desktop honours the enter-submits setting.
  isSubmitKey(e) {
    if ((e.isComposing || e.keyCode === 229) || e.key !== 'Enter') return false;
    if (Platform.isMobile) return false;
    return this.enterSubmits ? !e.shiftKey : (e.shiftKey || e.metaKey || e.ctrlKey);
  }
  // ---- Card Editing: Modal Focus (centered large card, darkened background, virtual keyboard pushes modal viewport, saves on close) ----
  startEditTile(tileEl, fresh) {
    if (this._lockGuard()) return;
    const tid = Number(tileEl.dataset.tid);
    if (!this.allTiles[tid]) return;
    const removeFresh = () => { if (fresh && tileEl.isConnected) { tileEl.remove(); this.renumber(); this.persist(); } };   // Discard a newly inserted empty placeholder card (M1)
    new TileEditModal(this.app, this, {
      text: this.allTiles[tid].text,
      onSave: (v) => this.applyTileEdit(tid, v),   // Save (✓) always commits — even an empty fresh card becomes a blank tile (tugtile lays out blank spacer tiles on purpose); changed-your-mind discard still runs via onDiscard (Cancel/Escape on an untouched fresh card)
      onDiscard: removeFresh,
    }).open();
  }
  // Save from modal to update card (updates model, writes file, redraws view)
  applyTileEdit(tid, v) {
    const tile = this.allTiles[tid]; if (!tile) { new Notice(t('editLost')); return; }   // Card no longer exists → notify user instead of silently failing (H1)
    const marker = (/^- \[(.)\]/.exec(tile.raw) || [null, ' '])[1];
    const newRaw = this.buildRaw(v, marker, tile.block);
    this.allTiles[tid] = { raw: newRaw, text: v, check: marker, block: tile.block };
    this._reopenRaw = newRaw;   // Reopen this edited card expanded after redraw show changes immediately
    this.persist().then(() => this.render()).then(() => {
      if (this._lastPersistError) { const e = this._lastPersistError; new Notice(t('persistFailed', (e && e.message) || String(e))); }
      else new Notice(t('saved'));   // Explicit save confirmation (previously silent, which caused confusion)
    });
  }
  // Accordion expand: only one card expanded at a time; clicking another card or clicking outside collapses it.
  // The tile height snaps (one reflow, not a per-frame layout animation — that stutters on content-heavy tiles
  // on iOS); instead the revealed body slides + fades in via GPU transform/opacity (see tugtile-body-reveal).
  expandCard(tileEl) {
    const prev = this._expandedEl;
    if (prev && prev !== tileEl && prev.isConnected && prev.dataset.long === 'true') prev.addClass('tugtile__tile--folded');
    tileEl.removeClass('tugtile__tile--folded');
    tileEl.addClass('tugtile__tile--revealing');
    if (tileEl._revealT) clearTimeout(tileEl._revealT);
    tileEl._revealT = setTimeout(() => { tileEl.removeClass('tugtile__tile--revealing'); tileEl._revealT = null; }, 240);
    this._expandedEl = tileEl;
    this.refreshFoldIcon();   // a tile expanded → resync the cycle button (B1)
  }
  collapseExpanded() {
    const el = this._expandedEl;
    if (el && el.isConnected && el.dataset.long === 'true' && !this._cardsExpanded) el.addClass('tugtile__tile--folded');
    this._expandedEl = null;
    this.refreshFoldIcon();   // a tile collapsed → resync the cycle button (B1)
  }
  // Freezes board height when editing in modal → prevents layout reflows and flickering when virtual keyboard appears
  freezeBoard() {
    const board = this.contentEl.querySelector('.tugtile__board');
    if (board && !board.dataset.frozen) { board.dataset.frozen = '1'; board.style.height = board.offsetHeight + 'px'; }
  }
  unfreezeBoard() {
    const board = this.contentEl.querySelector('.tugtile__board');
    if (board && board.dataset.frozen) { delete board.dataset.frozen; board.style.height = ''; }
  }

  // ---- Card Deletion ----
  deleteTile(tileEl) {
    tileEl.remove();
    this.persist().then(() => this.toastUndo(t('deletedTile')));   // Show toast only after successful write, ensuring undo references the correct state
  }

  // ---- Lane: Creation / Renaming / Deletion ----
  renderAddColButton(addColEl) {
    addColEl.empty();
    const btn = addColEl.createEl('button', { cls: 'tugtile__addcol-btn', text: t('addLaneBtn') });
    btn.onclick = () => this.showAddColumn(addColEl);
  }
  showAddColumn(addColEl) {
    if (this._lockGuard()) return;
    const board = addColEl.parentElement;
    this._openPromptBar({ placeholder: t('addLanePlaceholder'), icon: 'plus', onSubmit: (val) => { const name = val.trim(); if (name) this.addColumn(board, name); this.consumePendingReload(); } });
  }
  addColumn(board, name) {
    const laneEl = this.makeLane(board, { header: '## ' + name, title: name, tiles: [] });
    const addColEl = board.querySelector('.tugtile__addcol');
    if (addColEl) board.insertBefore(laneEl, addColEl);
    this.persist();
    this.renumber();
  }
  startRenameColumn(laneEl, titleEl) {
    if (this._lockGuard()) return;
    const cur = titleEl.textContent;
    this._openPromptBar({ value: cur, placeholder: t('addLanePlaceholder'), icon: 'pencil', onSubmit: (val) => {
      const newTitle = (val.trim()) || cur;
      titleEl.textContent = newTitle;
      const tv = laneEl.querySelector('.tugtile__lane-title-v'); if (tv) tv.textContent = newTitle;   // Keep the vertical clone in sync
      if (newTitle !== cur) { const max = laneEl.dataset.wip; laneEl.dataset.header = '## ' + newTitle + (max ? ' (' + max + ')' : ''); this.persist(); }   // Retain WIP limit
      this.consumePendingReload();
    } });
  }
  // ---- Keyboard-command helpers (bound from addCommand so users can assign hotkeys) ----
  // The lane to act on for command-driven create/rename: the lane of the currently focused card, else the first lane.
  // Keyboard commands have no mouse position, so anchoring on focus (with a sensible first-lane fallback) is the predictable choice.
  _activeLane() {
    const focused = this.contentEl.querySelector('.tugtile__tile:focus');
    if (focused) { const lane = focused.closest('.tugtile__lane'); if (lane) return lane; }
    return this.contentEl.querySelector('.tugtile__lane');
  }
  // Command: add a card to the active lane, opening the exact same add-card modal the "+ Add" button uses.
  cmdNewCard() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    const lane = this._activeLane(); if (!lane) return;
    const list = lane.querySelector('.tugtile__list');
    const footer = lane.querySelector('.tugtile__add');
    if (list && footer) this.showAddInput(footer, list);
  }
  // Command: add a new lane — same flow as the "+ Lane" button (opens the prompt bar to name it).
  cmdNewLane() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    const addColEl = this.contentEl.querySelector('.tugtile__addcol');
    if (addColEl) this.showAddColumn(addColEl);
  }
  // Command: rename the active lane — same flow as clicking the lane title (opens the prompt bar pre-filled).
  cmdRenameLane() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    const lane = this._activeLane(); if (!lane) return;
    const title = lane.querySelector('.tugtile__lane-title');
    if (title) this.startRenameColumn(lane, title);
  }
  deleteColumn(laneEl) {
    const n = laneEl.querySelectorAll('.tugtile__tile').length;
    if (n > 0 && typeof confirm === 'function' && !confirm(t('confirmDeleteLane', n))) return;
    laneEl.remove();
    this.persist().then(() => this.toastUndo(t('deletedLane')));
  }
  // Archives all completed cards on the board (checked tasks + cards in a Complete lane) — matches kanban "Archive completed cards" action
  archiveCompleted() {
    if (this.viewMode !== 'board') { new Notice(t('boardListViewOnly')); return; }
    let n = 0;
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((laneEl) => {
      const complete = (laneEl.dataset.lead || '').indexOf('**Complete**') !== -1;
      Array.from(laneEl.querySelectorAll('.tugtile__tile')).forEach((tileEl) => {
        const tile = this.allTiles[Number(tileEl.dataset.tid)];
        if (tile && (complete || /^- \[x\]/i.test(tile.raw))) { this.addToArchive(tile.raw); tileEl.remove(); n++; }
      });
    });
    if (n) { this.renumber(); this.persist().then(() => this.toastUndo(t('archivedCompleted', n))); }
    else new Notice(t('noCompleted'));
  }

  // Lane ⋯ / Context menu
  openLaneMenu(e, laneEl) {
    if (this._lockGuard()) return;
    if (this._dragging || this.recentlyDragged()) { if (e.preventDefault) e.preventDefault(); return; }
    const menu = new Menu();
    const titleEl = laneEl.querySelector('.tugtile__lane-title');
    menu.addItem((i) => i.setTitle(t('rename')).setIcon('pencil').onClick(() => { if (titleEl) this.startRenameColumn(laneEl, titleEl); }));
    menu.addItem((i) => i.setTitle(t('insertLaneBefore')).setIcon('arrow-left').onClick(() => this.insertColumn(laneEl, false)));
    menu.addItem((i) => i.setTitle(t('insertLaneAfter')).setIcon('arrow-right').onClick(() => this.insertColumn(laneEl, true)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('sortTitleAsc')).setIcon('arrow-down-narrow-wide').onClick(() => this.sortColumn(laneEl, 1, 'title')));   // A→Z: down arrow (reads top-to-bottom), narrow→wide
    menu.addItem((i) => i.setTitle(t('sortTitleDesc')).setIcon('arrow-up-wide-narrow').onClick(() => this.sortColumn(laneEl, -1, 'title')));
    menu.addItem((i) => i.setTitle(t('sortDate')).setIcon('calendar').onClick(() => this.sortColumn(laneEl, 1, 'date')));
    menu.addItem((i) => i.setTitle(t('sortTag')).setIcon('tag').onClick(() => this.sortColumn(laneEl, 1, 'tag')));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('markLaneComplete')).setIcon('check-check').onClick(() => this.markColumnComplete(laneEl)));
    menu.addItem((i) => i.setTitle(t('archiveLaneMenu')).setIcon('archive').onClick(() => this.archiveColumn(laneEl)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(t('deleteLaneMenu')).setIcon('trash').onClick(() => this.deleteColumn(laneEl)));
    this._trackMenu(menu, e); menu.showAtMouseEvent(e);
  }
  // Marks all cards in the lane as completed (- [ ] → - [x])
  markColumnComplete(laneEl) {
    laneEl.querySelectorAll('.tugtile__tile').forEach((tileEl) => {
      const tid = Number(tileEl.dataset.tid);
      const tile = this.allTiles[tid];
      if (/^- \[ \]/.test(tile.raw)) {
        this.allTiles[tid] = { raw: tile.raw.replace(/^- \[.\]/, '- [x]'), text: tile.text, check: 'x', block: tile.block };   // Preserve blockId (M1)
        const cb = tileEl.querySelector('.tugtile__check'); if (cb) cb.checked = true;
      }
    });
    this.persist();
  }
  // Archives all cards in the lane (adds to archive, leaving the lane empty)
  archiveColumn(laneEl) {
    const tiles = Array.from(laneEl.querySelectorAll('.tugtile__tile'));
    if (!tiles.length) return;
    if (typeof confirm === 'function' && !confirm(t('confirmArchiveLane', tiles.length))) return;
    tiles.forEach((tileEl) => { this.addToArchive(this.allTiles[Number(tileEl.dataset.tid)].raw); tileEl.remove(); });
    this.renumber();
    this.persist().then(() => this.toastUndo(t('archivedLane', tiles.length)));
  }
  // Sorts cards within the lane (key: title|date|tag; dir=1 asc / -1 desc; uses localeCompare for CJK support)
  sortColumn(laneEl, dir, key) {
    const list = laneEl.querySelector('.tugtile__list');
    if (!list) return;
    const val = (el) => {
      const t = this.allTiles[Number(el.dataset.tid)] || {};
      if (key === 'date') return extractMeta(t.text || '', this.dateTrigger, this.timeTrigger).date || '￿';   // Sort cards without dates to the bottom
      if (key === 'tag') return extractTags(t.text || '')[0] || '￿';
      return t.text || '';
    };
    const tiles = Array.from(list.querySelectorAll('.tugtile__tile'));
    tiles.sort((a, b) => dir * val(a).localeCompare(val(b), 'zh-Hant'));
    tiles.forEach((t) => list.appendChild(t));
    this.persist();
    this.renumber();
  }
  insertColumn(refLaneEl, after) {
    const board = refLaneEl.parentElement;
    const newName = t('newLane');
    const laneEl = this.makeLane(board, { header: '## ' + newName, title: newName, tiles: [] });
    board.insertBefore(laneEl, after ? refLaneEl.nextSibling : refLaneEl);
    this.persist();
    this.renumber();
    const t = laneEl.querySelector('.tugtile__lane-title');
    if (t) this.startRenameColumn(laneEl, t);
  }

  // ---- Archive View (View, restore, or permanently delete archived cards) ----
  splitArchive() {
    const lines = (this.model.archive || '').split('\n');
    const prefix = []; const cards = []; let cur = null;
    for (const ln of lines) {
      if (/^- \[.\]/.test(ln)) { if (cur) cards.push(cur); cur = [ln]; }
      else if (cur) cur.push(ln);
      else prefix.push(ln);
    }
    if (cur) cards.push(cur);
    const trim = (cl) => { const c = cl.slice(); while (c.length && c[c.length - 1].trim() === '') c.pop(); return c.join('\n'); };
    return { prefix: prefix.join('\n').replace(/\s+$/, ''), cards: cards.map(trim) };
  }
  rebuildArchive(prefix, cardRaws) {
    if (!cardRaws.length) return '';                 // Archive empty → clean up the entire archive section
    return (prefix ? prefix + '\n\n' : '***\n\n## ' + (this.archiveHeading || 'Archive') + '\n\n') + cardRaws.join('\n');
  }
  restoreArchived(index) {
    const { prefix, cards } = this.splitArchive();
    if (index < 0 || index >= cards.length) return;
    let raw = cards[index];   // Restore content as-is (timestamps added during archiving remain part of the restored text)
    const hm = /\s*%%tg-home:(.*?)%%/.exec(raw);   // recorded home lane (if any) → restore there; strip the token from the card
    const home = hm ? hm[1] : null;
    if (hm) raw = raw.replace(/\s*%%tg-home:.*?%%/, '');
    const cm = /^- \[(.)\]/.exec(raw);
    let targetList = null;
    if (home) { for (const lane of this.contentEl.querySelectorAll('.tugtile__lane')) { if (homeKey(this._laneName(lane)) === home) { targetList = lane.querySelector('.tugtile__list'); break; } } }
    if (!targetList) targetList = this.contentEl.querySelector('.tugtile__list');   // home gone / renamed / not recorded → first lane
    if (!targetList) { new Notice(t('noLaneToRestore')); return; }
    this.makeTileEl(targetList, { raw, text: tileRenderText(raw.split('\n')), check: cm ? cm[1] : ' ' });
    cards.splice(index, 1);
    this.model.archive = this.rebuildArchive(prefix, cards);
    this.persist();
    this.renumber();
  }
  deleteArchived(index) {
    const { prefix, cards } = this.splitArchive();
    if (index < 0 || index >= cards.length) return;
    cards.splice(index, 1);
    this.model.archive = this.rebuildArchive(prefix, cards);
    this.persist();
  }
  openArchiveView() {
    new ArchiveModal(this.app, this).open();
  }
  // ---- Backups (surface the silent _tugtile-backups snapshots so the safety net is visible + restorable) ----
  openBackupView() { new BackupModal(this.app, this).open(); }
  listBackups() {   // this board's backup files, newest first (timestamp is in the filename → lexicographic desc)
    const base = (this.filePath || '').split('/').pop().replace(/\.md$/, '');
    const folder = this.app.vault.getAbstractFileByPath('_tugtile-backups');
    if (!base || !folder || !folder.children) return [];
    return folder.children.filter((f) => isBackupOf(f.name, base)).sort((a, b) => (a.name < b.name ? 1 : -1));
  }
  openBackup(file) { this.app.workspace.getLeaf(true).openFile(file); }
  async restoreFromBackup(file) {
    const cur = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!cur) return;
    try {
      const content = await this.app.vault.read(file);
      this._backedUp = false; await this.backupOnce(cur);   // snapshot the CURRENT state first → restoring is itself reversible
      await this.app.vault.modify(cur, content);
      await this.render();
      new Notice(t('backupRestored'));
    } catch (e) { new Notice(t('backupRestoreFailed')); }
  }
  openBoardSettings() {
    new BoardSettingsModal(this.app, this).open();
  }

  renumber() {
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((laneEl) => {
      const tiles = laneEl.querySelectorAll('.tugtile__tile');
      tiles.forEach((tileEl, idx) => {
        // Both card body and collapsed title contain a sequence number; update both locations
        tileEl.querySelectorAll('.tugtile__num').forEach((num) => { num.textContent = String(idx + 1); });
      });
      const count = laneEl.querySelector('.tugtile__lane-count');
      if (count) {
        const max = laneEl.dataset.wip;
        if (max) {
          count.textContent = tiles.length + ' / ' + max;
          count.classList.toggle('tugtile__lane-count--over', tiles.length > Number(max));   // Over-limit indicator
        } else {
          count.textContent = String(tiles.length);
          count.classList.remove('tugtile__lane-count--over');
        }
      }
    });
  }

  async backupOnce(file) {
    if (this._backedUp) return;
    const folder = '_tugtile-backups';
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch (e) {}
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = file.path.split('/').pop().replace(/\.md$/, '');
    const orig = await this.app.vault.read(file);
    await this.app.vault.create(folder + '/' + base + '-' + ts + '.md', orig);  // Do not catch exceptions here
    this._backedUp = true;   // Lock backup status only after successful file creation
    await this._pruneBackups();   // honour the user's version-history limit
  }
  // Keep only the newest N backups of THIS board (backupRetention; -1/unset = keep all); delete the oldest beyond the cap.
  async _pruneBackups() {
    const keep = this.backupRetention;
    if (typeof keep !== 'number' || keep < 0) return;
    const files = this.listBackups();   // newest first
    for (let i = keep; i < files.length; i++) { try { await this.app.vault.delete(files[i]); } catch (e) {} }
  }

  // Serialization: prevents overlapping write operations (avoids false-positive external modifications and desynchronization of undo/_loadedText)
  // Board View: rebuilds model from DOM and writes back (captures drag-and-drop and insertions/deletions)
  persist() {
    this._persistChain = (this._persistChain || Promise.resolve())
      .then(() => this._doPersist())
      .then(() => { this._lastPersistError = null; })
      .catch((e) => { this._lastPersistError = e; console.error('tugtile persist failed', e); });   // Do not swallow errors; record exception for callers to handle
    return this._persistChain;
  }
  async _doPersist() {
    const columns = [];
    const collapse = [];
    this.contentEl.querySelectorAll('.tugtile__lane').forEach((laneEl) => {
      const header = laneEl.dataset.header || '## ';
      const lead = laneEl.dataset.lead ? laneEl.dataset.lead.split('\n') : [];
      const tiles = [];
      laneEl.querySelectorAll('.tugtile__tile').forEach((tileEl) => {
        tiles.push(this.allTiles[Number(tileEl.dataset.tid)]);
      });
      columns.push({ header, lead, tiles });
      collapse.push(laneEl.dataset.collapsed === 'true');
    });
    this.model.columns = columns;   // Synchronize model with DOM (ensures a reliable source for table/list views)
    this.model.post = setListCollapse(this.model.post, collapse);   // Save collapse states aligned with lane order (syncs automatically across reordering/modifications)
    await this._write(serializeFile({ pre: this.model.pre, columns, archive: this.model.archive, post: this.model.post, eol: this.model.eol }));
  }
  // Table/List View: serializes this.model directly (since there are no lane DOM elements to read, _doPersist cannot be used)
  persistModel() {
    this._persistChain = (this._persistChain || Promise.resolve())
      .then(() => this._write(serializeFile(this.model))).catch(() => {});
    return this._persistChain;
  }
  // One-way "upgrade to tugtile format": rewrites the file off obsidian-kanban markers (clean). Undoable. Button lives in board settings, only when kanban markers are present.
  async migrateToTugtileFormat() {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) return;
    let text; try { text = await this.app.vault.read(file); } catch (e) { return; }
    const out = migrateToTugtile(text);
    if (out === text) return;   // Already tugtile-native
    this._undo.push(text); if (this._undo.length > 50) this._undo.shift(); this._redo = []; this.updateUndoRedoActions();   // Make the upgrade undoable (↩ restores the kanban version)
    await this._write(out);
    await this.render();
    new Notice(t('migrateDone'));
  }
  // Shared file writer: handles concurrency protection, backups, undo stack, and updates _loadedText (reused by _doPersist and persistModel)
  async _write(out) {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) return;
    let prev = null;
    try { prev = await this.app.vault.read(file); } catch (e) {}
    if (prev !== null && this._loadedText != null && prev !== this._loadedText && prev !== out) {
      new Notice(t('externalModified'));
      await this.render();
      return;
    }
    try {
      await this.backupOnce(file);
    } catch (e) {
      new Notice(t('backupFailed'));
      return;
    }
    this._writing = true;
    try {
      await this.app.vault.modify(file, out);
      if (prev !== null && prev !== out) { this._undo.push(prev); if (this._undo.length > 50) this._undo.shift(); this._redo = []; this.updateUndoRedoActions(); }   // New action pushes an undo step and clears the redo branch
      this._loadedText = out;
      this.renumber();
    } catch (e) {
      new Notice(t('writeFailed', e.message));
    } finally {
      this._writing = false;
    }
  }

  // Restores the previous state (interventions for dragging, deleting cards/lanes, edits, or additions — which kanban doesn't support)
  async undo() { return this._timeTravel(this._undo, this._redo, t('undoVerb')); }
  async redo() { return this._timeTravel(this._redo, this._undo, t('redoVerb')); }
  async _timeTravel(fromStack, toStack, label) {
    if (this._lockGuard()) return;   // Undo/redo mutate content → blocked while locked
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) return;
    if (!fromStack.length) { new Notice(t('noStep', label)); return; }
    let cur = ''; try { cur = await this.app.vault.read(file); } catch (e) {}
    const target = fromStack.pop();
    if (cur !== '') toStack.push(cur);   // Push to opposite stack to allow navigating between undo and redo
    this._writing = true;
    try { await this.app.vault.modify(file, target); this._loadedText = target; }
    finally { this._writing = false; }
    await this.render();
    this.updateUndoRedoActions();
    new Notice(t('timeTraveled', label, this._undo.length, this._redo.length));
  }
  // Undo and redo are both always present; when their stack is empty the button is greyed out (tugtile-act-off) instead of hidden — a predictable, stable toolbar on desktop and mobile alike
  updateUndoRedoActions() {
    if (this._undoActionEl) this._undoActionEl.toggleClass('tugtile-act-off', this._undo.length === 0);
    if (this._redoActionEl) this._redoActionEl.toggleClass('tugtile-act-off', this._redo.length === 0);
  }
  // Shows a "toast with undo link" after destructive actions for quick recovery (natural on mobile devices)
  toastUndo(msg) {
    const n = new Notice(msg, 8000);
    const btn = n.noticeEl.createEl('a', { cls: 'tugtile-toast-undo', text: t('toastUndoBtn') });
    btn.onclick = (e) => { e.preventDefault(); n.hide(); this.undo(); };
  }
}

// Archive Modal: lists archived cards, allowing them to be restored (to the first lane) or permanently deleted
class ArchiveModal extends Modal {
  constructor(app, view) { super(app); this.view = view; }
  onOpen() { this.render(); }
  onClose() { if (this._comp) this._comp.unload(); this.contentEl.empty(); }
  render() {
    if (this._comp) this._comp.unload();
    this._comp = new Component(); this._comp.load();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tugtile-archive-modal');
    contentEl.createEl('h3', { text: t('archiveTitle') });
    const { cards } = this.view.splitArchive();
    if (!cards.length) { contentEl.createDiv({ cls: 'tugtile__empty', text: t('archiveEmpty') }); return; }
    const list = contentEl.createDiv({ cls: 'tugtile-archive-list' });
    cards.forEach((raw, idx) => {
      const row = list.createDiv({ cls: 'tugtile-archive-row' });
      const body = row.createDiv({ cls: 'tugtile-archive-body' });
      MarkdownRenderer.render(this.app, tileRenderText(raw.split('\n')), body, this.view.filePath, this._comp);
      const actions = row.createDiv({ cls: 'tugtile-archive-actions' });
      actions.createEl('button', { text: t('restore') }).onclick = () => { this.view.restoreArchived(idx); this.render(); };
      const del = actions.createEl('button', { cls: 'mod-warning', text: t('deleteArchived') });
      del.onclick = () => { this.view.deleteArchived(idx); this.render(); };
    });
  }
}

// Human-readable timestamp from a backup filename (<board>-2026-06-14T02-30-00-000Z.md → 2026-06-14 02:30:00)
function backupWhen(name) {
  const m = /-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name || '');
  return m ? (m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6]) : name;
}
// True when `name` is a backup snapshot of the board whose file base-name is `base`. Anchors the ISO timestamp
// suffix (`-YYYY-MM-DDTHH-mm-ss-SSSZ.md`) so board "Plan" does NOT also match board "Plan-2"'s backups — a plain
// startsWith(base+'-') collision would let one board's prune/restore touch another board's snapshots (data loss).
function isBackupOf(name, base) {
  if (!name || !base) return false;
  if (!name.startsWith(base + '-')) return false;
  return /^-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/.test(name.slice(base.length));
}
// Backups Modal: lists this board's _tugtile-backups snapshots (newest first), with restore + open. Makes the
// silent safety net visible — and one tap reversible (restore backs up the current state before overwriting).
class BackupModal extends Modal {
  constructor(app, view) { super(app); this.view = view; }
  onOpen() { this.render(); }
  onClose() { this.contentEl.empty(); }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tugtile-archive-modal');
    contentEl.createEl('h3', { text: t('backupTitle') });
    contentEl.createEl('p', { cls: 'setting-item-description', text: t('backupDesc') });
    const files = this.view.listBackups();
    if (!files.length) { contentEl.createDiv({ cls: 'tugtile__empty', text: t('backupEmpty') }); return; }
    const list = contentEl.createDiv({ cls: 'tugtile-archive-list' });
    files.forEach((f) => {
      const row = list.createDiv({ cls: 'tugtile-archive-row' });
      row.createDiv({ cls: 'tugtile-archive-body', text: backupWhen(f.name) });
      const actions = row.createDiv({ cls: 'tugtile-archive-actions' });
      actions.createEl('button', { text: t('backupOpen') }).onclick = () => { this.view.openBackup(f); this.close(); };
      actions.createEl('button', { cls: 'mod-warning', text: t('restore') }).onclick = () => {
        new ConfirmModal(this.app, { title: t('backupTitle'), message: t('backupRestoreConfirm'), confirmText: t('restore'), onConfirm: async () => { await this.view.restoreFromBackup(f); this.close(); } }).open();
      };
    });
  }
}

// Board-specific settings Modal: writes the board's %% tugtile:settings (and edits a legacy %% kanban:settings in place when present)
// Minimal confirm dialog (Obsidian has no built-in confirm). Runs onConfirm only when the user taps the confirm button.
class ConfirmModal extends Modal {
  constructor(app, opts) { super(app); this._opts = opts || {}; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('tugtile-prompt');
    if (this._opts.title) contentEl.createEl('h3', { text: this._opts.title });
    contentEl.createEl('p', { cls: 'setting-item-description', text: this._opts.message || '' });
    const row = contentEl.createDiv({ cls: 'tugtile-prompt-row' });
    row.createEl('button', { text: t('cancel') }).onclick = () => this.close();
    row.createEl('button', { cls: 'mod-warning', text: this._opts.confirmText || t('confirm') }).onclick = () => { this._ok = true; this.close(); };
  }
  onClose() { this.contentEl.empty(); if (this._ok && this._opts.onConfirm) this._opts.onConfirm(); }
}

class BoardSettingsModal extends Modal {
  constructor(app, view) { super(app); this.view = view; this._dirty = false; }
  onOpen() { this.render(); }
  onClose() { this.contentEl.empty(); if (this._dirty) this.view.render(); }
  set(key, value) {
    this.view.model.post = setSetting(this.view.model.post, key, value);
    this.view.persistModel();
    this._dirty = true;
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tugtile-archive-modal');
    contentEl.createEl('h3', { text: t('boardSettingsTitle') });
    contentEl.createEl('p', { cls: 'setting-item-description', text: t('boardSettingsDesc') });
    // "Upgrade to tugtile format" — shown only while the file still carries obsidian-kanban markers; one-way, clean (drops kanban-only settings)
    if (/kanban-plugin/.test(this.view.model.pre || '') || (this.view.model.post || '').indexOf('kanban:settings') !== -1) {
      new Setting(contentEl).setName(t('migrateBtn')).setDesc(t('migrateBtnDesc'))
        .addButton((b) => b.setButtonText(t('migrateBtn')).setCta().onClick(() => {
          new ConfirmModal(this.app, { title: t('migrateBtn'), message: t('migrateConfirm'), confirmText: t('migrateBtn'), onConfirm: () => { this.close(); this.view.migrateToTugtileFormat(); } }).open();
        }));
    }
    const bs = this.view.model.settings || {};
    const S = this.view.plugin.settings || DEFAULT_SETTINGS;
    const tog = (name, desc, key, dflt) => new Setting(contentEl).setName(name).setDesc(desc)
      .addToggle((t) => t.setValue(bs[key] !== undefined ? !!bs[key] : !!dflt).onChange((v) => this.set(key, v)));
    const txt = (name, desc, key, dflt) => new Setting(contentEl).setName(name).setDesc(desc)
      .addText((tx) => { tx.setPlaceholder(String(dflt)); if (bs[key] !== undefined) tx.setValue(String(bs[key])); tx.onChange((v) => this.set(key, v)); });
    const dd = (name, desc, key, opts, dflt) => new Setting(contentEl).setName(name).setDesc(desc)
      .addDropdown((d) => { opts.forEach(([val, label]) => d.addOption(val, label)); d.setValue(bs[key] !== undefined ? String(bs[key]) : dflt); d.onChange((v) => this.set(key, v)); });

    tog(t('setShowCheckboxes'), '', 'show-checkboxes', S.showCheckboxes);
    tog(t('setHideCount'), '', 'hide-card-count', S.hideCounts);
    dd(t('setEnterBehavior'), t('setEnterBehaviorDesc'), 'new-line-trigger', [['shift-enter', t('optEnterSubmit')], ['enter', t('optEnterNewline')]], S.enterSubmits ? 'shift-enter' : 'enter');
    dd(t('setNewCardPos'), '', 'new-card-insertion-method', [['append', t('optAppend')], ['prepend', t('optPrepend')], ['prepend-compact', t('optPrependCompact')]], S.prependNewCards ? 'prepend' : 'append');
    tog(t('setRelativeDate'), t('setRelativeDateDesc'), 'show-relative-date', S.showRelativeDate);
    txt(t('setDateFormat'), t('setDateFormatDesc'), 'date-format', 'YYYY-MM-DD');
    txt(t('setDateDisplay'), t('setDateDisplayDesc'), 'date-display-format', bs['date-format'] || 'YYYY-MM-DD');
    txt(t('setDateTrigger'), t('setDateTriggerDesc'), 'date-trigger', '@');
    txt(t('setTimeTrigger'), t('setTimeTriggerDesc'), 'time-trigger', '@@');
    tog(t('setLinkDaily'), t('setLinkDailyDesc'), 'link-date-to-daily-note', false);
    dd(t('setTagAction'), t('setTagActionDesc'), 'tag-action', [['board', t('optFilterBoard')], ['obsidian', t('optSearchVault')]], 'board');   // Default 'board' = filter this board (matches runtime default)
    tog(t('setMoveTags'), '', 'move-tags', false);
    tog(t('setArchiveWithDate'), '', 'archive-with-date', S.archiveWithDate);
  }
}
module.exports = class TugtilePlugin extends Plugin {
  // Mobile: the bottom navbar's back/forward are dead inside a board (no in-board history), and its search is
  // vault-wide. While a tugtile board is the active view, take them over — back→undo, forward→redo,
  // search→in-board tile filter. Event-delegated in the capture phase so it survives the navbar being rebuilt,
  // identifies buttons by class/icon (not localized labels), and only fires inside a board (native elsewhere).
  patchMobileNav() {
    if (!Platform.isMobile) return;
    const handler = (e) => {
      const view = this.app.workspace.getActiveViewOfType(BoardView);
      if (!view) return;   // not in a board → leave the native navbar untouched
      const tgt = e.target;
      const action = (tgt && tgt.closest) ? tgt.closest('.mobile-navbar-action') : null;
      if (!action || !action.closest('.mobile-navbar')) return;
      let fn = null;
      // Identify by the navbar's chevron icons (not the desktop titlebar's mod-back/forward) OR our own marker
      // (once the icon is swapped to undo/redo the chevron class is gone, so the data-attr is the stable key).
      if (action.dataset.tugtileNav === 'undo' || action.classList.contains('mod-back') || action.querySelector('.lucide-chevron-left')) fn = () => view.undo();
      else if (action.dataset.tugtileNav === 'redo' || action.classList.contains('mod-forward') || action.querySelector('.lucide-chevron-right')) fn = () => view.redo();
      else if (action.querySelector('.lucide-search')) fn = () => view.openSearch();
      if (!fn) return;
      e.preventDefault(); e.stopImmediatePropagation();
      fn();
    };
    // Cover both: whichever event the native button fires on, a document-level capture listener runs first
    this.registerDomEvent(document, 'click', handler, true);
    this.registerDomEvent(document, 'touchend', handler, true);
    // Swap the chevron icons for undo/redo icons while a board is active, restore them when it isn't
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this._syncMobileNavIcons()));
    this.app.workspace.onLayoutReady(() => this._syncMobileNavIcons());
  }
  _navActions() {
    const navbar = document.querySelector('.mobile-navbar');
    if (!navbar) return null;
    let back = null, fwd = null;
    navbar.querySelectorAll('.mobile-navbar-action').forEach((a) => {
      if (a.dataset.tugtileNav === 'undo' || a.querySelector('.lucide-chevron-left')) back = a;
      else if (a.dataset.tugtileNav === 'redo' || a.querySelector('.lucide-chevron-right')) fwd = a;
    });
    return { back, fwd };
  }
  // Swap ONLY the svg's inner paths + viewBox, keeping the navbar's own <svg> element (its classes + sizing) —
  // replacing the whole svg via setIcon shifted the buttons out of position.
  _swapNavIcon(actionEl, name) {
    const old = actionEl.querySelector('svg');
    if (!old) { setIcon(actionEl, name); return; }
    const tmp = document.createElement('div'); setIcon(tmp, name);
    const neu = tmp.querySelector('svg');
    if (!neu) return;
    old.innerHTML = neu.innerHTML;
    const vb = neu.getAttribute('viewBox'); if (vb) old.setAttribute('viewBox', vb);
  }
  _syncMobileNavIcons() {
    if (!Platform.isMobile) return;
    const a = this._navActions(); if (!a) return;
    const inBoard = !!this.app.workspace.getActiveViewOfType(BoardView);
    const set = (el, onIcon, offIcon, marker) => {
      if (!el) return;
      if (inBoard) { if (el.dataset.tugtileNav !== marker) { this._swapNavIcon(el, onIcon); el.dataset.tugtileNav = marker; } }
      else if (el.dataset.tugtileNav === marker) { this._swapNavIcon(el, offIcon); delete el.dataset.tugtileNav; }
    };
    set(a.back, 'undo', 'chevron-left', 'undo');
    set(a.fwd, 'redo', 'chevron-right', 'redo');
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new TugtileSettingTab(this.app, this));
    // _mdOverride: maps "file path" to boolean, recording board files explicitly requested by the user to open in markdown view (stores overrides only, not VIEW_TYPE).
    // Uses file path as consistent key for setting (setMarkdownView), reading (patch), and clearing (setBoardView, detach) to prevent setting leakage across files.
    this._mdOverride = {};
    this.registerView(VIEW_TYPE, (leaf) => new BoardView(leaf, this));

    // Hook: monkeypatches setViewState to automatically open markdown files containing kanban-plugin frontmatter in the tugtile board view.
    // Safe unregistration: onunload sets _unloaded flag to bypass wrapper logic; wrapper transparently delegates execution, avoiding calls to unloaded plugin instances even if wrapped by other plugins.
    const self = this;
    this.register(aroundMethod(WorkspaceLeaf.prototype, 'setViewState', (next) => function (state, ...rest) {
      if (!self._unloaded && self._ready && state && state.type === 'markdown' && state.state && state.state.file &&
          self._mdOverride[state.state.file] !== true && self.isBoardFile(state.state.file)) {
        return next.apply(this, [{ ...state, type: VIEW_TYPE }, ...rest]);
      }
      return next.apply(this, [state, ...rest]);
    }));
    this.register(aroundMethod(WorkspaceLeaf.prototype, 'detach', (next) => function () {
      if (!self._unloaded) {
        const st = this.view && this.view.getState && this.view.getState();
        if (st && st.file) delete self._mdOverride[st.file];
      }
      return next.apply(this);
    }));
    // Markdown files already open at startup (which bypasses monkeypatch interception) → migrate to board view
    this.app.workspace.onLayoutReady(() => { this._ready = true; this.sweepBoardLeaves(); });
    // Override kanban: retrieves board files if hijacked by markdown view or obsidian-kanban (no ping-ponging: kanban only intercept markdown types, letting tugtile types pass through)
    this.registerEvent(this.app.workspace.on('layout-change', () => { if (this._ready) this.sweepBoardLeaves(); }));
    this.patchMobileNav();

    this.addCommand({
      id: 'toggle-view',
      name: t('cmdToggleView'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isBoardFile(file.path)) return false;
        if (!checking) {
          const bv = this.app.workspace.getActiveViewOfType(BoardView);
          if (bv) this.setMarkdownView(bv.leaf);
          else { const mv = this.app.workspace.getActiveViewOfType(MarkdownView); if (mv) this.setBoardView(mv.leaf); }
        }
        return true;
      },
    });
    this.addCommand({
      id: 'open-as-board',
      name: t('cmdOpenAsBoard'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.openBoard(file.path);
        return true;
      },
    });
    this.addCommand({
      id: 'undo',
      name: t('cmdUndo'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.undo();
        return true;
      },
    });
    this.addCommand({
      id: 'redo',
      name: t('cmdRedo'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.redo();
        return true;
      },
    });
    this.addCommand({
      id: 'create-board',
      name: t('cmdCreateBoard'),
      callback: () => this.createBoard(),
    });
    this.addCommand({
      id: 'search',
      name: t('cmdSearch'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.openSearch();
        return true;
      },
    });
    this.addCommand({
      id: 'new-card',
      name: t('cmdNewCard'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.cmdNewCard();
        return true;
      },
    });
    this.addCommand({
      id: 'new-lane',
      name: t('cmdNewLane'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.cmdNewLane();
        return true;
      },
    });
    this.addCommand({
      id: 'rename-lane',
      name: t('cmdRenameLane'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.cmdRenameLane();
        return true;
      },
    });
    this.addCommand({
      id: 'archive-completed',
      name: t('cmdArchiveCompleted'),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BoardView);
        if (!view) return false;
        if (!checking) view.archiveCompleted();
        return true;
      },
    });
    this.addCommand({
      id: 'convert-to-board',
      name: t('cmdConvertToBoard'),
      checkCallback: (checking) => {
        const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mv || !mv.file) return false;
        if (!checking) this.convertToBoard(mv);
        return true;
      },
    });
    // File Explorer / Tab context menu: appends "Open as tugtile Board" / "Open as Markdown" options for board files (matches standard kanban entry points)
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
      if (!file) return;
      if (file.children !== undefined) {   // Folder → Create board in folder
        menu.addItem((i) => i.setTitle(t('createBoardHere')).setIcon('gallery-vertical').onClick(() => this.createBoard(file)));
        return;
      }
      if (file.extension !== 'md' || !leaf) return;
      if (leaf.view instanceof BoardView) {
        menu.addItem((i) => i.setTitle(t('openAsMarkdownAction')).setIcon('file-text').onClick(() => this.setMarkdownView(leaf)));
      } else if (leaf.view instanceof MarkdownView && this.isBoardFile(file.path)) {
        menu.addItem((i) => i.setTitle(t('openAsBoard')).setIcon('gallery-vertical').onClick(() => this.setBoardView(leaf)));
      }
    }));
    this.addRibbonIcon('gallery-vertical', t('ribbonTitle'), () => {
      const file = this.app.workspace.getActiveFile();
      if (file && file.extension === 'md') this.openBoard(file.path);
      else new Notice(t('ribbonNoFile'));
    });
  }
  // Converts active markdown note to board in-place (adds frontmatter and settings, then opens as board)
  async convertToBoard(mv) {
    try {
      const cur = await this.app.vault.read(mv.file);
      if (!this.isBoardFile(mv.file.path) && !/^---[\s\S]*(kanban-plugin|tugtile-plugin)/.test(cur)) {
        const fm = '---\n\ntugtile-plugin: board\n\n---\n\n';   // New boards are born tugtile-native
        const tail = (cur.indexOf('%% kanban:settings') === -1 && cur.indexOf('%% tugtile:settings') === -1) ? '\n\n%% tugtile:settings\n```\n{}\n```\n%%\n' : '';
        await this.app.vault.modify(mv.file, fm + cur + tail);
      }
      await this.setBoardView(mv.leaf);
    } catch (e) { new Notice(t('convertFailed', e.message)); }
  }
  async createBoard(folder) {
    // Create in the specified folder or the folder containing the active file (matches kanban behavior, does not default to vault root)
    let dir = '';
    try {
      const active = this.app.workspace.getActiveFile();
      const parent = folder || (this.app.fileManager.getNewFileParent ? this.app.fileManager.getNewFileParent(active ? active.path : '') : null);
      if (parent && parent.path && parent.path !== '/') dir = parent.path + '/';
    } catch (e) {}
    const base = t('newBoardName');
    let name = base, n = 2;
    while (this.app.vault.getAbstractFileByPath(dir + name + '.md')) { name = base + ' ' + n; n++; }
    const path = dir + name + '.md';
    const tmpl = '---\ntugtile-plugin: board\n---\n\n\n\n%% tugtile:settings\n```\n{}\n```\n%%\n';
    try {
      await this.app.vault.create(path, tmpl);
      await this.openBoard(path);
      new Notice(t('boardCreated', name));
    } catch (e) {
      new Notice(t('createBoardFailed', e.message));
    }
  }
  isBoardFile(path) {
    if (!path || !path.endsWith('.md')) return false;
    const cache = this.app.metadataCache.getCache(path);
    return !!(cache && cache.frontmatter && (cache.frontmatter['tugtile-plugin'] || cache.frontmatter['kanban-plugin']));   // Dual-read: native tugtile key + legacy obsidian-kanban key
  }
  async setBoardView(leaf) {
    const st = (leaf.view && leaf.view.getState && leaf.view.getState()) || {};
    if (st.file) delete this._mdOverride[st.file];   // Clear markdown view override
    await leaf.setViewState({ type: VIEW_TYPE, state: st, popstate: true });
  }
  // Scan all leaves: boards hijacked by markdown or obsidian-kanban → reclaim as tugtile
  sweepBoardLeaves() {   // Debounce: coalesces rapid layout-change events into a single scan (replaces broken synchronization flag, M3)
    if (this._unloaded) return;
    clearTimeout(this._sweepT);
    this._sweepT = setTimeout(() => { if (!this._unloaded) this._sweepBoardLeaves(); }, 60);
  }
  _sweepBoardLeaves() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view; if (!v || !v.getViewType) return;
      const vt = v.getViewType();
      if (vt !== 'markdown' && vt !== 'kanban') return;        // Only reclaim markdown and kanban views
      const f = v.file || (v.getState && v.getState().file);
      const path = f && (f.path || f);
      if (path && this.isBoardFile(path) && this._mdOverride[path] !== true) this.setBoardView(leaf);
    });
  }
  async setMarkdownView(leaf) {
    const st = (leaf.view && leaf.view.getState && leaf.view.getState()) || {};
    if (st.file) this._mdOverride[st.file] = true;   // Mark file to open in markdown view (prevents setViewState redirection)
    await leaf.setViewState({ type: 'markdown', state: st, popstate: true });
  }
  // Public API for the tile family (marktile calls this). tugtile globally hooks setViewState to reclaim board
  // files as boards, so a sibling plugin can't open one in Obsidian's native editor on its own — this is the
  // sanctioned escape hatch (sets the override, then switches). Named "Obsidian" not "Markdown" on purpose: in
  // the family, *the* Markdown editor is marktile; this one means Obsidian's built-in editor.
  openAsObsidian(leaf) { return this.setMarkdownView(leaf || this.app.workspace.getMostRecentLeaf()); }
  async openBoard(path) {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: path } });
    this.app.workspace.revealLeaf(leaf);
  }
  async saveSettings() {
    await this.saveData(this.settings);
    // Redraw active board views after configuration changes to apply settings instantly
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => { if (l.view && l.view.render) l.view.render(); });
  }
  onunload() {
    // Per Obsidian plugin guidelines: do NOT detachLeavesOfType here — Obsidian reinitializes
    // open leaves at their original position on update; detaching ourselves causes problems.
    this._unloaded = true; clearTimeout(this._sweepT);
    const a = this._navActions();   // Restore the native chevron icons if we'd swapped them for undo/redo
    if (a) { if (a.back && a.back.dataset.tugtileNav) { this._swapNavIcon(a.back, 'chevron-left'); delete a.back.dataset.tugtileNav; } if (a.fwd && a.fwd.dataset.tugtileNav) { this._swapNavIcon(a.fwd, 'chevron-right'); delete a.fwd.dataset.tugtileNav; } }
  }
};

// Global settings panel (individual board settings in kanban:settings override these defaults)
class TugtileSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h3', { text: t('settingsTitle') });
    containerEl.createEl('p', { cls: 'setting-item-description', text: t('settingsDesc') });

    new Setting(containerEl).setName(t('safetyHeading')).setDesc(t('backupDesc'));   // make the (already-built) safety net legible

    new Setting(containerEl)
      .setName(t('gShowCheckboxes'))
      .setDesc(t('gShowCheckboxesDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.showCheckboxes).onChange(async (v) => { this.plugin.settings.showCheckboxes = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gHideCount'))
      .setDesc(t('gHideCountDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.hideCounts).onChange(async (v) => { this.plugin.settings.hideCounts = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gResponsiveBoard'))
      .setDesc(t('gResponsiveBoardDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.responsiveBoard).onChange(async (v) => { this.plugin.settings.responsiveBoard = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gLaneWidth'))
      .setDesc(t('gLaneWidthDesc'))
      .then((s) => {   // Three side-by-side buttons (segmented), active one highlighted
        const btns = {};
        [['narrow', t('optDenseTight')], ['medium', t('optDenseMid')], ['wide', t('optDenseLoose')]].forEach(([val, label]) => {
          s.addButton((b) => { btns[val] = b; b.setButtonText(label).onClick(async () => {
            this.plugin.settings.laneWidth = val; await this.plugin.saveSettings();
            Object.keys(btns).forEach((v) => (v === val ? btns[v].setCta() : btns[v].removeCta()));
          }); });
        });
        const cur = LANE_WIDTHS[this.plugin.settings.laneWidth] ? this.plugin.settings.laneWidth : 'medium';
        Object.keys(btns).forEach((v) => { if (v === cur) btns[v].setCta(); });
      });

    new Setting(containerEl)
      .setName(t('gTableDensity'))
      .setDesc(t('gTableDensityDesc'))
      .then((s) => {   // Table row spacing — same narrow/medium/wide segmented style as lane width
        const btns = {};
        [['narrow', t('optDenseTight')], ['medium', t('optDenseMid')], ['wide', t('optDenseLoose')]].forEach(([val, label]) => {
          s.addButton((b) => { btns[val] = b; b.setButtonText(label).onClick(async () => {
            this.plugin.settings.tableDensity = val; await this.plugin.saveSettings();
            Object.keys(btns).forEach((v) => (v === val ? btns[v].setCta() : btns[v].removeCta()));
          }); });
        });
        const cur = TABLE_PADS[this.plugin.settings.tableDensity] ? this.plugin.settings.tableDensity : 'medium';
        Object.keys(btns).forEach((v) => { if (v === cur) btns[v].setCta(); });
      });

    // Two separate pickers: text-formatting buttons vs insert/special buttons (search/undo/redo are always on, not listed)
    const toolPicker = (name, desc, cat) => new Setting(containerEl).setName(name).setDesc(desc).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const et = this.plugin.settings.editorTools || (this.plugin.settings.editorTools = {});
      EDITOR_TOOLS.forEach((tk) => {
        if (tk === 'sep' || tk === 'rowbreak' || tk.fixed || tk.cat !== cat) return;
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = et[tk.key] !== false;
        const glyph = lbl.createSpan({ cls: 'tugtile-tool-chk-i' });
        if (tk.icon) setIcon(glyph, tk.icon); else glyph.textContent = tk.g;   // Show the same icon the toolbar uses
        cb.onchange = async () => { et[tk.key] = cb.checked; await this.plugin.saveSettings(); };
      });
    });
    toolPicker(t('gFormatTools'), t('gFormatToolsDesc'), 'format');
    toolPicker(t('gBlockTools'), t('gBlockToolsDesc'), 'block');
    toolPicker(t('gInsertTools'), t('gInsertToolsDesc'), 'insert');
    // Which view modes the big editor's cycle rotates through — same picker marktile has. The modal
    // reads this at open, so a change takes effect on the next card open (no reload needed).
    new Setting(containerEl).setName(t('mtModesPick')).setDesc(t('mtModesPickDesc')).then((s) => {
      s.controlEl.addClass('tugtile-tools-pick');
      const md = this.plugin.settings.modes || (this.plugin.settings.modes = {});
      EDITOR_MODES.forEach((m) => {
        const lbl = s.controlEl.createEl('label', { cls: 'tugtile-tool-chk' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = md[m.key] !== false;
        setIcon(lbl.createSpan({ cls: 'tugtile-tool-chk-i' }), m.icon);
        lbl.createSpan({ text: t(m.name) });
        cb.onchange = async () => {
          const willOn = EDITOR_MODES.filter((x) => (x.key === m.key ? cb.checked : md[x.key] !== false));
          if (!willOn.length) { cb.checked = true; new Notice(t('mtModesMinOne')); return; }   // keep at least one mode
          md[m.key] = cb.checked; await this.plugin.saveSettings();
        };
      });
    });

    new Setting(containerEl)
      .setName(t('mtSeasonedColor'))
      .setDesc(t('mtSeasonedColorDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.seasonedColor).onChange(async (v) => { this.plugin.settings.seasonedColor = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gEnterSubmit'))
      .setDesc(t('gEnterSubmitDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.enterSubmits).onChange(async (v) => { this.plugin.settings.enterSubmits = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gPrepend'))
      .setDesc(t('gPrependDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.prependNewCards).onChange(async (v) => { this.plugin.settings.prependNewCards = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gRelativeDate'))
      .setDesc(t('gRelativeDateDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.showRelativeDate).onChange(async (v) => { this.plugin.settings.showRelativeDate = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gDateDisplay'))
      .setDesc(t('gDateDisplayDesc'))
      .addText((tx) => tx.setValue(this.plugin.settings.dateDisplayFormat || 'YYYY-MM-DD').onChange(async (v) => { this.plugin.settings.dateDisplayFormat = v.trim() || 'YYYY-MM-DD'; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('gArchiveWithDate'))
      .setDesc(t('gArchiveWithDateDesc'))
      .addToggle((tg) => tg.setValue(!!this.plugin.settings.archiveWithDate).onChange(async (v) => { this.plugin.settings.archiveWithDate = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName(t('backupRetentionName'))
      .setDesc(t('backupRetentionDesc'))
      .addText((tx) => tx.setValue(String(this.plugin.settings.backupRetention)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= -1) { this.plugin.settings.backupRetention = n; await this.plugin.saveSettings(); }
      }));

    new Setting(containerEl)
      .setName(t('gArchiveHeading'))
      .setDesc(t('gArchiveHeadingDesc'))
      .addText((tx) => tx.setValue(this.plugin.settings.archiveHeading || 'Archive').onChange(async (v) => { this.plugin.settings.archiveHeading = v.trim() || 'Archive'; await this.plugin.saveSettings(); }));

    containerEl.createEl('h4', { text: t('gDanger') });
    new Setting(containerEl).setName(t('keyboardHintName')).setDesc(t('keyboardHint'));   // make the keyboard card-move discoverable

    // tile family cross-discovery: tell tugtile users marktile exists (even if not installed)
    const hasMt = !!(this.app.plugins && this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('marktile'));
    const fam = new Setting(containerEl).setName(t('familyMarktile')).setDesc(hasMt ? t('familyHave') : t('familyMarktileDesc'));
    if (!hasMt) fam.addButton((b) => b.setButtonText(t('familyGet')).onClick(() => window.open('obsidian://show-plugin?id=marktile')));

    new Setting(containerEl)
      .setName(t('gReset'))
      .setDesc(t('gResetDesc'))
      .addButton((b) => b.setButtonText(t('gResetBtn')).setWarning().onClick(async () => { this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS); await this.plugin.saveSettings(); this.display(); }));
  }
}
